const config = require('../../config');
const { ApiError, asyncHandler } = require('../errors');
const { recordEventSafely } = require('../../repositories/securityEvents.repo');
const { authenticateToken } = require('../../services/auth.service');
const { verifyCsrfToken } = require('../../security/csrf');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const allowedOrigins = new Set(config.auth.allowedOrigins);

const authenticate = asyncHandler(async (req, res, next) => {
  const token = req.cookies && req.cookies[config.auth.cookie.name];
  req.auth = await authenticateToken(token, req.ip);
  req.user = {
    id: req.auth.user_id,
    email: req.auth.email,
    displayName: req.auth.display_name,
  };
  next();
});

function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

function requireCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('Origin');
  const token = req.get('X-CSRF-Token');
  if (!origin || !allowedOrigins.has(origin) || !verifyCsrfToken(req.auth.id, token)) {
    recordEventSafely({
      type: 'auth.csrf_failed',
      actorUserId: req.auth.user_id,
      sessionId: req.auth.id,
      ipAddress: req.ip,
      details: {
        reason: !origin ? 'origin_missing' : !allowedOrigins.has(origin) ? 'origin_not_allowed' : 'token_invalid',
        method: req.method,
        path: req.originalUrl,
        origin: origin ? origin.slice(0, 256) : null,
      },
    });
    return next(new ApiError(403, 'CSRF_FAILED', 'CSRF validation failed'));
  }
  next();
}

module.exports = { authenticate, noStore, requireCsrf };
