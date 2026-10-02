const db = require('../db/pool');
const { recordSecurityEvent } = require('./securityEvents.repo');

async function findUserForSignIn(email) {
  const { rows } = await db.query(
    `SELECT id, email::text AS email, password_hash, display_name, is_active, locked_until
       FROM fw_users
      WHERE email = $1`,
    [email],
  );
  return rows[0] || null;
}

async function recordSignInFailure({ userId, emailHash, ipAddress }) {
  await recordSecurityEvent(db, {
    type: 'auth.sign_in_failed',
    targetUserId: userId,
    ipAddress,
    details: { emailHash },
  });
}

async function lockUserAfterFailedAttempts({ userId, maxFailures, windowSeconds, durationSeconds, ipAddress }) {
  return db.withTransaction(async (client) => {
    await client.query('SELECT id FROM fw_users WHERE id = $1 FOR UPDATE', [userId]);
    const { rows: counted } = await client.query(
      `SELECT count(*)::int AS failures
         FROM fw_security_events
        WHERE event_type = 'auth.sign_in_failed'
          AND target_user_id = $1
          AND occurred_at > now() - ($2 * interval '1 second')`,
      [userId, windowSeconds],
    );
    if (counted[0].failures < maxFailures) return null;

    const { rows } = await client.query(
      `UPDATE fw_users
          SET locked_until = now() + ($2 * interval '1 second')
        WHERE id = $1
          AND (locked_until IS NULL OR locked_until <= now())
        RETURNING locked_until`,
      [userId, durationSeconds],
    );
    if (!rows[0]) return null;

    await recordSecurityEvent(client, {
      type: 'auth.account_locked',
      targetUserId: userId,
      ipAddress,
      details: { failures: counted[0].failures, windowSeconds, durationSeconds },
    });
    return rows[0].locked_until;
  });
}

async function purgeStaleSessions(retentionSeconds) {
  const { rowCount } = await db.query(
    `DELETE FROM fw_sessions
      WHERE absolute_expires_at < now() - ($1 * interval '1 second')
         OR (revoked_at IS NOT NULL AND revoked_at < now() - ($1 * interval '1 second'))`,
    [retentionSeconds],
  );
  return rowCount;
}

async function createSession({ userId, tokenHash, idleTtlSeconds, absoluteTtlSeconds, ipAddress, userAgent }) {
  return db.withTransaction(async (client) => {
    const userResult = await client.query(
      `SELECT id, email::text AS email, display_name, is_active, locked_until, password_hash
         FROM fw_users
        WHERE id = $1
        FOR UPDATE`,
      [userId],
    );
    const user = userResult.rows[0];
    if (
      !user ||
      !user.is_active ||
      user.password_hash === '!' ||
      (user.locked_until && user.locked_until > new Date())
    ) {
      const error = new Error('User is not available for sign-in');
      error.code = 'AUTH_USER_UNAVAILABLE';
      throw error;
    }

    const sessionResult = await client.query(
      `INSERT INTO fw_sessions
         (user_id, token_hash, idle_expires_at, absolute_expires_at, ip_address, user_agent)
       VALUES (
         $1,
         $2,
         now() + ($3 * interval '1 second'),
         now() + ($4 * interval '1 second'),
         $5,
         $6
       )
       RETURNING id, created_at, last_seen_at, idle_expires_at, absolute_expires_at`,
      [userId, tokenHash, idleTtlSeconds, absoluteTtlSeconds, ipAddress || null, userAgent || null],
    );
    const session = sessionResult.rows[0];

    await client.query('UPDATE fw_users SET last_login_at = now() WHERE id = $1', [userId]);
    await recordSecurityEvent(client, {
      type: 'auth.sign_in_succeeded',
      actorUserId: userId,
      targetUserId: userId,
      sessionId: session.id,
      ipAddress,
    });

    return { ...session, user };
  });
}

const SESSION_SELECT = `
  SELECT s.id,
         s.user_id,
         s.created_at,
         s.last_seen_at,
         s.idle_expires_at,
         s.absolute_expires_at,
         s.revoked_at,
         s.revoked_reason,
         u.email::text AS email,
         u.display_name,
         u.is_active,
         u.locked_until,
         COALESCE(
           (SELECT json_agg(
                     json_build_object(
                       'id', role_rows.id,
                       'name', role_rows.name,
                       'systemKey', role_rows.system_key
                     )
                     ORDER BY role_rows.name, role_rows.id
                   )
              FROM (
                SELECT DISTINCT r.id, r.name::text AS name, r.system_key
                  FROM fw_user_roles ur
                  JOIN fw_roles r ON r.id = ur.role_id
                 WHERE ur.user_id = u.id AND r.is_active
              ) role_rows),
           '[]'::json
         ) AS roles,
         COALESCE(
           (SELECT array_agg(DISTINCT rp.permission_key ORDER BY rp.permission_key)
              FROM fw_user_roles ur
              JOIN fw_roles r ON r.id = ur.role_id AND r.is_active
              JOIN fw_role_permissions rp ON rp.role_id = r.id
             WHERE ur.user_id = u.id),
           ARRAY[]::varchar[]
         ) AS permissions
    FROM fw_sessions s
    JOIN fw_users u ON u.id = s.user_id`;

async function findSessionByTokenHash(tokenHash) {
  const { rows } = await db.query(`${SESSION_SELECT} WHERE s.token_hash = $1`, [tokenHash]);
  return rows[0] || null;
}

async function touchSession(id, idleTtlSeconds, touchIntervalSeconds) {
  const { rows } = await db.query(
    `UPDATE fw_sessions
        SET last_seen_at = now(),
            idle_expires_at = LEAST(now() + ($2 * interval '1 second'), absolute_expires_at)
      WHERE id = $1
        AND revoked_at IS NULL
        AND last_seen_at <= now() - ($3 * interval '1 second')
        AND idle_expires_at > now()
        AND absolute_expires_at > now()
      RETURNING last_seen_at, idle_expires_at`,
    [id, idleTtlSeconds, touchIntervalSeconds],
  );
  return rows[0] || null;
}

async function rejectSession(id, reason, ipAddress) {
  await db.withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE fw_sessions
          SET revoked_at = now(), revoked_reason = $2
        WHERE id = $1 AND revoked_at IS NULL
        RETURNING user_id`,
      [id, reason],
    );
    if (!rows[0]) return;
    await recordSecurityEvent(client, {
      type: 'auth.session_rejected',
      targetUserId: rows[0].user_id,
      sessionId: id,
      ipAddress,
      details: { reason },
    });
  });
}

async function revokeSession(id, userId, ipAddress) {
  return db.withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE fw_sessions
          SET revoked_at = now(), revoked_reason = 'signed_out'
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [id, userId],
    );
    if (!rowCount) return false;
    await recordSecurityEvent(client, {
      type: 'auth.signed_out',
      actorUserId: userId,
      targetUserId: userId,
      sessionId: id,
      ipAddress,
    });
    return true;
  });
}

async function revokeUserSessions(client, userId, reason) {
  const { rowCount } = await client.query(
    `UPDATE fw_sessions
        SET revoked_at = now(), revoked_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
  return rowCount;
}

async function revokeRoleSessions(client, roleId, reason) {
  const { rows } = await client.query(
    `UPDATE fw_sessions s
        SET revoked_at = now(), revoked_reason = $2
       FROM fw_user_roles ur
      WHERE ur.role_id = $1
        AND ur.user_id = s.user_id
        AND s.revoked_at IS NULL
      RETURNING s.user_id`,
    [roleId, reason],
  );
  return [...new Set(rows.map((row) => row.user_id))];
}

module.exports = {
  createSession,
  findSessionByTokenHash,
  findUserForSignIn,
  lockUserAfterFailedAttempts,
  purgeStaleSessions,
  recordSignInFailure,
  rejectSession,
  revokeRoleSessions,
  revokeSession,
  revokeUserSessions,
  touchSession,
};
