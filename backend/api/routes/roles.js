const express = require('express');
const { ApiError, asyncHandler, uuidParam } = require('../errors');
const { parseCreateRole, parseUpdateRole } = require('../dto/rbac.dto');
const { requirePermissions } = require('../middleware/permissions');
const rbacRepository = require('../../repositories/rbac.repo');
const rbacService = require('../../services/rbac.service');

const router = express.Router();
router.param('id', uuidParam('Role'));

router.get(
  '/',
  requirePermissions('roles.view'),
  asyncHandler(async (req, res) => {
    res.json(await rbacRepository.listRoles());
  }),
);

router.get(
  '/:id',
  requirePermissions('roles.view'),
  asyncHandler(async (req, res) => {
    const role = await rbacRepository.findRole(req.params.id);
    if (!role) throw new ApiError(404, 'NOT_FOUND', 'Role not found');
    res.json(role);
  }),
);

router.post(
  '/',
  requirePermissions('roles.create'),
  asyncHandler(async (req, res) => {
    const role = await rbacService.createRole(parseCreateRole(req.body), rbacService.actorFromRequest(req));
    res.status(201).location(req.baseUrl + '/' + role.id).json(role);
  }),
);

router.put(
  '/:id',
  requirePermissions('roles.update'),
  asyncHandler(async (req, res) => {
    const role = await rbacService.updateRole(
      req.params.id,
      parseUpdateRole(req.body),
      rbacService.actorFromRequest(req),
    );
    res.json(role);
  }),
);

module.exports = router;
