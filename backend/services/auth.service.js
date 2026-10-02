const crypto = require('node:crypto');
const config = require('../config');
const { ApiError } = require('../api/errors');
const authRepository = require('../repositories/auth.repo');
const { createCsrfToken } = require('../security/csrf');
const { DUMMY_PASSWORD_HASH, verifyPassword } = require('../security/passwords');
const { createSessionToken, hashSessionToken } = require('../security/sessions');

function invalidCredentials() {
  return new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
}

function unauthenticated() {
  return new ApiError(401, 'UNAUTHENTICATED', 'Authentication is required');
}

function toPayload(session) {
  return {
    user: {
      id: session.user_id || session.user.id,
      email: session.email || session.user.email,
      displayName: session.display_name || session.user.display_name,
    },
    roles: session.roles || [],
    permissions: session.permissions || [],
    session: {
      idleExpiresAt: session.idle_expires_at,
      absoluteExpiresAt: session.absolute_expires_at,
    },
    csrfToken: createCsrfToken(session.id),
  };
}

async function recordFailure(user, email, ipAddress) {
  const emailHash = crypto.createHash('sha256').update(email, 'utf8').digest('hex');
  await authRepository.recordSignInFailure({ userId: user && user.id, emailHash, ipAddress });
  if (!user) return;
  await authRepository.lockUserAfterFailedAttempts({
    userId: user.id,
    maxFailures: config.auth.lockout.maxFailures,
    windowSeconds: config.auth.lockout.windowSeconds,
    durationSeconds: config.auth.lockout.durationSeconds,
    ipAddress,
  });
}

async function signIn({ email, password, ipAddress, userAgent }) {
  const user = await authRepository.findUserForSignIn(email);
  const passwordHash = user && user.password_hash !== '!' ? user.password_hash : DUMMY_PASSWORD_HASH;
  const passwordMatches = await verifyPassword(passwordHash, password);
  const now = new Date();
  const eligible =
    user &&
    user.is_active &&
    user.password_hash !== '!' &&
    (!user.locked_until || user.locked_until <= now);

  if (!passwordMatches || !eligible) {
    await recordFailure(user, email, ipAddress);
    throw invalidCredentials();
  }

  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  let created;
  try {
    created = await authRepository.createSession({
      userId: user.id,
      tokenHash,
      idleTtlSeconds: config.auth.session.idleTtlSeconds,
      absoluteTtlSeconds: config.auth.session.absoluteTtlSeconds,
      ipAddress,
      userAgent: userAgent ? userAgent.slice(0, 512) : null,
    });
  } catch (err) {
    if (err.code !== 'AUTH_USER_UNAVAILABLE') throw err;
    await recordFailure(user, email, ipAddress);
    throw invalidCredentials();
  }

  const session = await authRepository.findSessionByTokenHash(tokenHash);
  return { token, payload: toPayload(session || created), absoluteExpiresAt: created.absolute_expires_at };
}

async function authenticateToken(token, ipAddress) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) throw unauthenticated();
  const session = await authRepository.findSessionByTokenHash(hashSessionToken(token));
  if (!session || session.revoked_at) throw unauthenticated();

  const now = new Date();
  let rejectionReason = null;
  if (session.absolute_expires_at <= now) rejectionReason = 'absolute_expired';
  else if (session.idle_expires_at <= now) rejectionReason = 'idle_expired';
  else if (!session.is_active) rejectionReason = 'user_inactive';
  else if (session.locked_until && session.locked_until > now) rejectionReason = 'user_locked';

  if (rejectionReason) {
    await authRepository.rejectSession(session.id, rejectionReason, ipAddress);
    throw unauthenticated();
  }

  const touched = await authRepository.touchSession(
    session.id,
    config.auth.session.idleTtlSeconds,
    config.auth.session.touchIntervalSeconds,
  );
  if (touched) {
    session.last_seen_at = touched.last_seen_at;
    session.idle_expires_at = touched.idle_expires_at;
  }

  session.permissionSet = new Set(session.permissions);
  session.csrfToken = createCsrfToken(session.id);
  return session;
}

async function signOut(session, ipAddress) {
  await authRepository.revokeSession(session.id, session.user_id, ipAddress);
}

module.exports = { authenticateToken, invalidCredentials, signIn, signOut, toPayload, unauthenticated };
