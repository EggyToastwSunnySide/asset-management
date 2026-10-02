const express = require('express');
const { asyncHandler } = require('../errors');
const { requirePermissions } = require('../middleware/permissions');
const rbacRepository = require('../../repositories/rbac.repo');

const router = express.Router();

router.get(
  '/',
  requirePermissions('roles.view'),
  asyncHandler(async (req, res) => {
    res.json(await rbacRepository.listPermissions());
  }),
);

module.exports = router;
