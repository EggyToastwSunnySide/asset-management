const db = require('../db/pool');
const { ApiError } = require('../api/errors');
const { validationError } = require('../api/validation');
const authRepository = require('./auth.repo');
const { recordSecurityEvent } = require('./securityEvents.repo');

const SELECT_ROLE = `
  SELECT r.id,
         r.name::text AS name,
         r.description,
         r.system_key,
         r.is_active,
         r.created_at,
         r.updated_at,
         COALESCE(
           array_agg(DISTINCT rp.permission_key ORDER BY rp.permission_key)
             FILTER (WHERE rp.permission_key IS NOT NULL),
           ARRAY[]::varchar[]
         ) AS permission_keys,
         count(DISTINCT ur.user_id)::int AS assigned_user_count
    FROM fw_roles r
    LEFT JOIN fw_role_permissions rp ON rp.role_id = r.id
    LEFT JOIN fw_user_roles ur ON ur.role_id = r.id`;

function fromRoleRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemKey: row.system_key,
    isActive: row.is_active,
    permissionKeys: row.permission_keys,
    assignedUserCount: row.assigned_user_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function roleNotFound() {
  return new ApiError(404, 'NOT_FOUND', 'Role not found');
}

async function listPermissions() {
  const { rows } = await db.query(
    'SELECT permission_key AS key, description FROM fw_permissions ORDER BY permission_key',
  );
  return rows;
}

async function listRoles() {
  const { rows } = await db.query(
    `${SELECT_ROLE}
     GROUP BY r.id
     ORDER BY (r.system_key IS NULL), r.name, r.id`,
  );
  return rows.map(fromRoleRow);
}

async function findRole(id, client = db) {
  const { rows } = await client.query(`${SELECT_ROLE} WHERE r.id = $1 GROUP BY r.id`, [id]);
  return rows[0] ? fromRoleRow(rows[0]) : null;
}

async function assertPermissionKeys(client, permissionKeys) {
  const { rows } = await client.query(
    'SELECT permission_key FROM fw_permissions WHERE permission_key = ANY($1::varchar[])',
    [permissionKeys],
  );
  if (rows.length !== permissionKeys.length) {
    const known = new Set(rows.map((row) => row.permission_key));
    const unknown = permissionKeys.filter((key) => !known.has(key));
    throw validationError({ permissionKeys: `Unknown permission keys: ${unknown.join(', ')}` });
  }
}

function translateRoleNameError(err) {
  if (err.code === '23505' && err.constraint === 'fw_roles_name_key') {
    return new ApiError(409, 'DUPLICATE_ROLE_NAME', 'A role with that name already exists', {
      name: 'A role with that name already exists',
    });
  }
  return err;
}

async function createRole(input, actor) {
  try {
    return await db.withTransaction(async (client) => {
      await assertPermissionKeys(client, input.permissionKeys);
      const { rows } = await client.query(
        `INSERT INTO fw_roles (name, description)
         VALUES ($1, $2)
         RETURNING id`,
        [input.name, input.description],
      );
      const roleId = rows[0].id;
      if (input.permissionKeys.length) {
        await client.query(
          `INSERT INTO fw_role_permissions (role_id, permission_key)
           SELECT $1, unnest($2::varchar[])`,
          [roleId, input.permissionKeys],
        );
      }
      await recordSecurityEvent(client, {
        type: 'rbac.role_created',
        actorUserId: actor.id,
        sessionId: actor.sessionId,
        ipAddress: actor.ipAddress,
        details: { roleId, permissionKeys: input.permissionKeys },
      });
      return findRole(roleId, client);
    });
  } catch (err) {
    throw translateRoleNameError(err);
  }
}

async function updateRole(id, input, actor) {
  try {
    return await db.withTransaction(async (client) => {
      const currentResult = await client.query(
        `SELECT id, name::text AS name, description, system_key, is_active
           FROM fw_roles
          WHERE id = $1
          FOR UPDATE`,
        [id],
      );
      const current = currentResult.rows[0];
      if (!current) throw roleNotFound();
      const permissionResult = await client.query(
        'SELECT permission_key FROM fw_role_permissions WHERE role_id = $1 ORDER BY permission_key',
        [id],
      );
      current.permission_keys = permissionResult.rows.map((row) => row.permission_key);
      if (current.system_key) {
        throw new ApiError(409, 'SYSTEM_ROLE_IMMUTABLE', 'Built-in roles cannot be changed');
      }
      await assertPermissionKeys(client, input.permissionKeys);

      await client.query(
        `UPDATE fw_roles
            SET name = $2, description = $3, is_active = $4
          WHERE id = $1`,
        [id, input.name, input.description, input.isActive],
      );
      await client.query('DELETE FROM fw_role_permissions WHERE role_id = $1', [id]);
      if (input.permissionKeys.length) {
        await client.query(
          `INSERT INTO fw_role_permissions (role_id, permission_key)
           SELECT $1, unnest($2::varchar[])`,
          [id, input.permissionKeys],
        );
      }

      const affectedUserIds = await authRepository.revokeRoleSessions(client, id, 'role_changed');
      await recordSecurityEvent(client, {
        type: 'rbac.role_updated',
        actorUserId: actor.id,
        sessionId: actor.sessionId,
        ipAddress: actor.ipAddress,
        details: {
          roleId: id,
          before: {
            name: current.name,
            description: current.description,
            isActive: current.is_active,
            permissionKeys: current.permission_keys,
          },
          after: input,
          affectedUserIds,
        },
      });
      return findRole(id, client);
    });
  } catch (err) {
    throw translateRoleNameError(err);
  }
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

const SELECT_USER = `
  SELECT u.id,
         u.email::text AS email,
         u.display_name,
         u.is_active,
         u.locked_until,
         u.last_login_at,
         u.created_at,
         u.updated_at,
         COALESCE(
           json_agg(
             json_build_object(
               'id', r.id,
               'name', r.name::text,
               'systemKey', r.system_key,
               'isActive', r.is_active
             )
             ORDER BY r.name, r.id
           ) FILTER (WHERE r.id IS NOT NULL),
           '[]'::json
         ) AS roles
    FROM fw_users u
    LEFT JOIN fw_user_roles ur ON ur.user_id = u.id
    LEFT JOIN fw_roles r ON r.id = ur.role_id`;

function fromUserRow(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isActive: row.is_active,
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at,
    roles: row.roles,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listUsers({ search, page, pageSize }) {
  const params = [];
  let where = '';
  if (search) {
    params.push('%' + escapeLike(search) + '%');
    where = `WHERE u.email ILIKE $1 ESCAPE '\\' OR u.display_name ILIKE $1 ESCAPE '\\'`;
  }
  const countResult = await db.query(`SELECT count(*)::int AS total FROM fw_users u ${where}`, params);
  const offset = (page - 1) * pageSize;
  const { rows } = await db.query(
    `${SELECT_USER}
     ${where}
     GROUP BY u.id
     ORDER BY u.display_name, u.email, u.id
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset],
  );
  return { items: rows.map(fromUserRow), total: countResult.rows[0].total, page, pageSize };
}

async function findUser(id, client = db) {
  const { rows } = await client.query(`${SELECT_USER} WHERE u.id = $1 GROUP BY u.id`, [id]);
  return rows[0] ? fromUserRow(rows[0]) : null;
}

async function replaceUserRoles(targetUserId, roleIds, actor) {
  return db.withTransaction(async (client) => {
    const adminRoleResult = await client.query(
      `SELECT id FROM fw_roles WHERE system_key = 'admin' FOR UPDATE`,
    );
    const adminRoleId = adminRoleResult.rows[0].id;

    const targetResult = await client.query(
      'SELECT id, is_active, password_hash, locked_until FROM fw_users WHERE id = $1 FOR UPDATE',
      [targetUserId],
    );
    if (!targetResult.rows[0]) throw new ApiError(404, 'NOT_FOUND', 'User not found');

    const rolesResult = await client.query(
      `SELECT id, name::text AS name, is_active
         FROM fw_roles
        WHERE id = ANY($1::uuid[])
        FOR SHARE`,
      [roleIds],
    );
    if (rolesResult.rows.length !== roleIds.length) {
      throw validationError({ roleIds: 'One or more roles do not exist' });
    }
    const inactive = rolesResult.rows.filter((role) => !role.is_active);
    if (inactive.length) {
      throw validationError({ roleIds: `Inactive roles cannot be assigned: ${inactive.map((role) => role.name).join(', ')}` });
    }

    const oldResult = await client.query(
      'SELECT role_id FROM fw_user_roles WHERE user_id = $1 ORDER BY role_id FOR UPDATE',
      [targetUserId],
    );
    const oldRoleIds = oldResult.rows.map((row) => row.role_id);
    const removingAdmin = oldRoleIds.includes(adminRoleId) && !roleIds.includes(adminRoleId);
    if (removingAdmin) {
      const usableAdmins = await client.query(
        `SELECT u.id
           FROM fw_user_roles ur
           JOIN fw_users u ON u.id = ur.user_id
          WHERE ur.role_id = $1
            AND u.is_active
            AND u.password_hash LIKE '$argon2%'
            AND (u.locked_until IS NULL OR u.locked_until <= now())
          FOR UPDATE OF u, ur`,
        [adminRoleId],
      );
      if (usableAdmins.rows.length <= 1 && usableAdmins.rows.some((row) => row.id === targetUserId)) {
        throw new ApiError(409, 'LAST_ADMIN_REQUIRED', 'The final active usable administrator cannot be removed');
      }
    }

    await client.query('DELETE FROM fw_user_roles WHERE user_id = $1', [targetUserId]);
    if (roleIds.length) {
      await client.query(
        `INSERT INTO fw_user_roles (user_id, role_id, assigned_by_user_id)
         SELECT $1, unnest($2::uuid[]), $3`,
        [targetUserId, roleIds, actor.id],
      );
    }
    await authRepository.revokeUserSessions(client, targetUserId, 'roles_changed');
    await recordSecurityEvent(client, {
      type: 'rbac.user_roles_replaced',
      actorUserId: actor.id,
      targetUserId,
      sessionId: actor.sessionId,
      ipAddress: actor.ipAddress,
      details: { oldRoleIds, roleIds },
    });
    return findUser(targetUserId, client);
  });
}

async function permissionsForRoles(roleIds, client = db) {
  const { rows } = await client.query(
    `SELECT DISTINCT rp.permission_key
       FROM fw_role_permissions rp
       JOIN fw_roles r ON r.id = rp.role_id
      WHERE rp.role_id = ANY($1::uuid[]) AND r.is_active`,
    [roleIds],
  );
  return rows.map((row) => row.permission_key);
}

module.exports = {
  createRole,
  findRole,
  findUser,
  listPermissions,
  listRoles,
  listUsers,
  permissionsForRoles,
  replaceUserRoles,
  roleNotFound,
  updateRole,
};
