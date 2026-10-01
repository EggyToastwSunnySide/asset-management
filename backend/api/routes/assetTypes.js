const express = require('express');
const { asyncHandler } = require('../errors');
const { currentUser } = require('../middleware/currentUser');
const { parseCreateAssetType, toAssetTypeDto } = require('../dto/assetTypes.dto');
const assetTypes = require('../../repositories/assetTypes.repo');

const router = express.Router();

/*
 * Asset types (US17). Mirrored by
 * frontend/src/features/asset-types/api/assetTypes.api.ts:
 *
 *   POST /api/asset-types  { code, name } -> 201 { code, name }
 *                          | 409 DUPLICATE_CODE (fields.code) | 409 DUPLICATE_NAME (fields.name)
 *                          | 422 VALIDATION_FAILED
 *
 * Listing stays in GET /api/reference-data (`types`).
 */

router.use(currentUser);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parseCreateAssetType(req.body);
    const type = await assetTypes.createAssetType(input);
    res.status(201).json(toAssetTypeDto(type));
  }),
);

module.exports = router;
