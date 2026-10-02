const express = require('express');
const { asyncHandler, uuidParam } = require('../errors');
const { parseRoleAssignment, parseUserListQuery } = require('../dto/rbac.dto');
const { requirePermissions } = require('../middleware/permissions');
const rbacRepository = require('../../repositories/rbac.repo');
const rbacService = require('../../services/rbac.service');

const router = express.Router();
router.param('id', uuidParam('User'));

router.get(
  '/',
  requirePermissions('users.view'),
  asyncHandler(async (req, res) => {
    res.json(await rbacRepository.listUsers(parseUserListQuery(req.query)));
  }),
);

router.put(
  '/:id/roles',
  requirePermissions('roles.assign'),
  asyncHandler(async (req, res) => {
    const { roleIds } = parseRoleAssignment(req.body);
    const user = await rbacService.replaceUserRoles(
      req.params.id,
      roleIds,
      rbacService.actorFromRequest(req),
    );
    res.json(user);
  }),
);

module.exports = router;
