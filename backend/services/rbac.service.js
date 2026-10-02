const { ApiError } = require('../api/errors');
const rbacRepository = require('../repositories/rbac.repo');

function assertCanDelegate(permissionKeys, actorPermissionSet) {
  const missing = permissionKeys.filter((key) => !actorPermissionSet.has(key));
  if (missing.length) {
    throw new ApiError(403, 'FORBIDDEN', 'You cannot delegate permissions you do not possess');
  }
}

function actorFromRequest(req) {
  return {
    id: req.auth.user_id,
    sessionId: req.auth.id,
    ipAddress: req.ip,
    permissionSet: req.auth.permissionSet,
  };
}

async function createRole(input, actor) {
  assertCanDelegate(input.permissionKeys, actor.permissionSet);
  return rbacRepository.createRole(input, actor);
}

async function updateRole(id, input, actor) {
  assertCanDelegate(input.permissionKeys, actor.permissionSet);
  return rbacRepository.updateRole(id, input, actor);
}

async function replaceUserRoles(targetUserId, roleIds, actor) {
  if (targetUserId === actor.id) {
    throw new ApiError(403, 'FORBIDDEN', 'You cannot change your own role assignments');
  }
  const delegatedPermissions = await rbacRepository.permissionsForRoles(roleIds);
  assertCanDelegate(delegatedPermissions, actor.permissionSet);
  return rbacRepository.replaceUserRoles(targetUserId, roleIds, actor);
}

module.exports = { actorFromRequest, createRole, replaceUserRoles, updateRole };
