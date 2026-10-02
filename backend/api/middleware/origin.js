const config = require('../../config');
const { ApiError } = require('../errors');
const { recordEventSafely } = require('../../repositories/securityEvents.repo');

const allowedOrigins = new Set(config.auth.allowedOrigins);

function recordOriginRejection(req, origin) {
  recordEventSafely({
    type: 'security.origin_rejected',
    actorUserId: req.auth ? req.auth.user_id : null,
    sessionId: req.auth ? req.auth.id : null,
    ipAddress: req.ip,
    details: {
      reason: origin ? 'origin_not_allowed' : 'origin_missing',
      method: req.method,
      path: req.originalUrl,
      origin: origin ? origin.slice(0, 256) : null,
    },
  });
}

function cors(req, res, next) {
  const origin = req.get('Origin');
  if (origin && allowedOrigins.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Credentials', 'true');
    res.vary('Origin');
  }

  if (req.method !== 'OPTIONS') return next();
  if (!origin || !allowedOrigins.has(origin)) {
    recordOriginRejection(req, origin);
    return next(new ApiError(403, 'FORBIDDEN', 'Origin is not allowed'));
  }
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type,X-CSRF-Token');
  res.set('Access-Control-Max-Age', '600');
  res.status(204).end();
}

function requireAllowedOrigin(req, res, next) {
  const origin = req.get('Origin');
  if (!origin || !allowedOrigins.has(origin)) {
    recordOriginRejection(req, origin);
    return next(new ApiError(403, 'FORBIDDEN', 'Origin is not allowed'));
  }
  next();
}

module.exports = { cors, requireAllowedOrigin };
