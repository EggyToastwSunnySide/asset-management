const db = require('../db/pool');
const { ApiError } = require('../api/errors');
const { recordSecurityEvent } = require('./securityEvents.repo');

async function createProvisionedUser({ email, displayName, passwordHash, bootstrapAdmin }) {
  try {
    return await db.withTransaction(async (client) => {
      const adminRoleResult = await client.query(
        `SELECT id FROM fw_roles WHERE system_key = 'admin' FOR UPDATE`,
      );
      const adminRoleId = adminRoleResult.rows[0] && adminRoleResult.rows[0].id;
      if (!adminRoleId) throw new Error('The built-in administrator role is missing');

      if (bootstrapAdmin) {
        const { rows } = await client.query(
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
        if (rows.length) {
          throw new ApiError(
            409,
            'BOOTSTRAP_ADMIN_EXISTS',
            'A usable system administrator already exists; create the account without --bootstrap-admin',
          );
        }
      }

      const { rows } = await client.query(
        `INSERT INTO fw_users (email, password_hash, display_name)
         VALUES ($1, $2, $3)
         RETURNING id, email::text AS email, display_name, is_active, created_at`,
        [email, passwordHash, displayName],
      );
      const user = rows[0];
      if (bootstrapAdmin) {
        await client.query(
          `INSERT INTO fw_user_roles (user_id, role_id, assigned_by_user_id)
           VALUES ($1, $2, NULL)`,
          [user.id, adminRoleId],
        );
      }
      await recordSecurityEvent(client, {
        type: 'account.provisioned',
        targetUserId: user.id,
        details: { bootstrapAdmin },
      });
      return {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        isActive: user.is_active,
        roles: bootstrapAdmin ? ['admin'] : [],
        createdAt: user.created_at,
      };
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'fw_users_email_key') {
      throw new ApiError(409, 'DUPLICATE_EMAIL', 'An account with that email already exists');
    }
    throw err;
  }
}

module.exports = { createProvisionedUser };
