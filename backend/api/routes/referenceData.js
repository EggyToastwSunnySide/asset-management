const express = require('express');
const { asyncHandler } = require('../errors');
const { requirePermissions } = require('../middleware/permissions');
const { listReferenceData } = require('../../repositories/referenceData.repo');

const router = express.Router();

/*
 * Codes the asset API accepts for type, status and location, with display
 * names, for form pickers and list filters:
 *
 *   GET /api/reference-data -> 200 { types, statuses, locations }, each [{ code, name }]
 */
router.get(
  '/',
  requirePermissions('assets.view'),
  asyncHandler(async (req, res) => {
    res.json(await listReferenceData());
  }),
);

module.exports = router;
