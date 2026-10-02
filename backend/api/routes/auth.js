const express = require('express');
const config = require('../../config');
const { asyncHandler } = require('../errors');
const { parseSignIn } = require('../dto/auth.dto');
const { noStore } = require('../middleware/auth');
const { requireAllowedOrigin } = require('../middleware/origin');
const { signInRateLimit } = require('../middleware/rateLimits');
const authService = require('../../services/auth.service');

const publicRouter = express.Router();
const protectedRouter = express.Router();

function cookieOptions(expires) {
  const cookie = config.auth.cookie;
  return {
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: cookie.path,
    ...(expires ? { expires: new Date(expires) } : {}),
  };
}

publicRouter.post(
  '/sign-in',
  noStore,
  requireAllowedOrigin,
  signInRateLimit,
  asyncHandler(async (req, res) => {
    const credentials = parseSignIn(req.body);
    const result = await authService.signIn({
      ...credentials,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });
    res.cookie(config.auth.cookie.name, result.token, cookieOptions(result.absoluteExpiresAt));
    res.json(result.payload);
  }),
);

protectedRouter.get('/session', (req, res) => {
  res.json(authService.toPayload(req.auth));
});

protectedRouter.post(
  '/sign-out',
  asyncHandler(async (req, res) => {
    await authService.signOut(req.auth, req.ip);
    res.clearCookie(config.auth.cookie.name, cookieOptions());
    res.status(204).end();
  }),
);

module.exports = { protectedRouter, publicRouter };
