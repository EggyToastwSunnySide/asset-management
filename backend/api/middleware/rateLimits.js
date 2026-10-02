const { rateLimit } = require('express-rate-limit');
const config = require('../../config');
const { recordEventSafely } = require('../../repositories/securityEvents.repo');

function handlerFor(scope) {
  return function handler(req, res) {
    recordEventSafely({
      type: 'security.rate_limited',
      actorUserId: req.auth ? req.auth.user_id : null,
      sessionId: req.auth ? req.auth.id : null,
      ipAddress: req.ip,
      details: { scope, method: req.method, path: req.originalUrl },
    });
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Try again later.',
      },
    });
  };
}

const common = {
  standardHeaders: true,
  legacyHeaders: false,
};

const signInRateLimit = rateLimit({
  ...common,
  windowMs: config.auth.rateLimit.signInWindowMs,
  limit: config.auth.rateLimit.signInMax,
  skipSuccessfulRequests: true,
  handler: handlerFor('sign_in'),
});

const protectedApiRateLimit = rateLimit({
  ...common,
  windowMs: config.auth.rateLimit.apiWindowMs,
  limit: config.auth.rateLimit.apiMax,
  handler: handlerFor('protected_api'),
});

module.exports = { protectedApiRateLimit, signInRateLimit };
