const { ApiError } = require('../api/errors');
const { validationError } = require('../api/validation');
const rbacRepository = require('../repositories/rbac.repo');

const PERMISSION_PREREQUISITES = {
  'assets.create': ['assets.view'],
  'assets.update': ['assets.view'],
  'assets.archive': ['assets.view'],
  'assets.restore': ['assets.view'],
  'exports.run': ['assets.view'],
  'exportProfiles.create': ['exportProfiles.view'],
  'exportProfiles.update': ['exportProfiles.view'],
  'exportProfiles.delete': ['exportProfiles.view'],
  'roles.create': ['roles.view'],
  'roles.update': ['roles.view'],
  'roles.assign': ['roles.view', 'users.view'],
};

function assertPermissionComposition(permissionKeys) {
  const selected = new Set(permissionKeys);
  const missing = [];
  for (const [permission, prerequisites] of Object.entries(PERMISSION_PREREQUISITES)) {
    if (!selected.has(permission)) continue;
    for (const prerequisite of prerequisites) {
      if (!selected.has(prerequisite)) missing.push(`${permission} requires ${prerequisite}`);
    }
  }
  if (missing.length) {
    throw validationError({ permissionKeys: `Missing prerequisite permissions: ${missing.join('; ')}` });
  }
}

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
  assertPermissionComposition(input.permissionKeys);
  assertCanDelegate(input.permissionKeys, actor.permissionSet);
  return rbacRepository.createRole(input, actor);
}

async function updateRole(id, input, actor) {
  assertPermissionComposition(input.permissionKeys);
  assertCanDelegate(input.permissionKeys, actor.permissionSet);
  return rbacRepository.updateRole(id, input, actor);
}

async function replaceUserRoles(targetUserId, roleIds, actor) {
  if (targetUserId === actor.id) {
    throw new ApiError(403, 'FORBIDDEN', 'You cannot change your own role assignments');
  }
  const delegatedPermissions = await rbacRepository.permissionsForRoles(roleIds);
  assertPermissionComposition(delegatedPermissions);
  assertCanDelegate(delegatedPermissions, actor.permissionSet);
  return rbacRepository.replaceUserRoles(targetUserId, roleIds, actor);
}

module.exports = { actorFromRequest, createRole, replaceUserRoles, updateRole };
