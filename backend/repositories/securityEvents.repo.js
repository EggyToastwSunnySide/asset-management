const db = require('../db/pool');

function recordSecurityEvent(client, event) {
  return client.query(
    `INSERT INTO fw_security_events
       (event_type, actor_user_id, target_user_id, session_id, ip_address, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      event.type,
      event.actorUserId || null,
      event.targetUserId || null,
      event.sessionId || null,
      event.ipAddress || null,
      JSON.stringify(event.details || {}),
    ],
  );
}

/** Best-effort audit for request middleware: an audit failure must not fail the request. */
function recordEventSafely(event) {
  recordSecurityEvent(db, event).catch(() => {});
}

module.exports = { recordEventSafely, recordSecurityEvent };
