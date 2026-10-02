const express = require('express');
const { asyncHandler, uuidParam } = require('../errors');
const { requirePermissions } = require('../middleware/permissions');
const { parseProfileInput, toProfileDto } = require('../dto/exportProfiles.dto');
const profiles = require('../../repositories/exportProfiles.repo');

const router = express.Router();

/*
 * Saved export profiles (S-04, ADR-0013: per-user database record). Mirrored by
 * frontend/src/features/export-profiles/api/profiles.http.ts:
 *
 *   GET    /api/export-profiles      -> 200 ExportProfile[]  (the caller's own, by name)
 *   GET    /api/export-profiles/:id  -> 200 ExportProfile
 *   POST   /api/export-profiles      ExportProfileInput -> 201 ExportProfile | 409 DUPLICATE_NAME
 *   PUT    /api/export-profiles/:id  ExportProfileInput -> 200 ExportProfile
 *   DELETE /api/export-profiles/:id  -> 204 (hard delete, frees the name)
 */

router.param('id', uuidParam('Export profile'));

router.get(
  '/',
  requirePermissions('exportProfiles.view'),
  asyncHandler(async (req, res) => {
    const rows = await profiles.listProfiles(req.user.id);
    res.json(rows.map(toProfileDto));
  }),
);

router.get(
  '/:id',
  requirePermissions('exportProfiles.view'),
  asyncHandler(async (req, res) => {
    const row = await profiles.findProfile(req.params.id, req.user.id);
    if (!row) throw profiles.profileNotFound();
    res.json(toProfileDto(row));
  }),
);

router.post(
  '/',
  requirePermissions('exportProfiles.create'),
  asyncHandler(async (req, res) => {
    const input = parseProfileInput(req.body);
    const row = await profiles.createProfile(req.user.id, input);
    res.status(201).location(req.baseUrl + '/' + row.id).json(toProfileDto(row));
  }),
);

router.put(
  '/:id',
  requirePermissions('exportProfiles.update'),
  asyncHandler(async (req, res) => {
    const input = parseProfileInput(req.body);
    const row = await profiles.updateProfile(req.params.id, req.user.id, input);
    res.json(toProfileDto(row));
  }),
);

router.delete(
  '/:id',
  requirePermissions('exportProfiles.delete'),
  asyncHandler(async (req, res) => {
    await profiles.deleteProfile(req.params.id, req.user.id);
    res.status(204).end();
  }),
);

module.exports = router;
