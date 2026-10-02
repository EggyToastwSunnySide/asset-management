const { ApiError } = require('../errors');
const { recordEventSafely } = require('../../repositories/securityEvents.repo');

function requirePermissions(...permissionKeys) {
  return function (req, res, next) {
    const permissions = req.auth && req.auth.permissionSet;
    if (!permissions || permissionKeys.some((key) => !permissions.has(key))) {
      recordEventSafely({
        type: 'authz.permission_denied',
        actorUserId: req.auth ? req.auth.user_id : null,
        sessionId: req.auth ? req.auth.id : null,
        ipAddress: req.ip,
        details: {
          required: permissionKeys,
          method: req.method,
          path: req.originalUrl,
        },
      });
      return next(new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action'));
    }
    next();
  };
}

module.exports = { requirePermissions };
