const express = require('express');
const { asyncHandler } = require('../errors');
const { currentUser } = require('../middleware/currentUser');
const {
  parseCreateAssetType,
  parseCreateAttribute,
  toAssetTypeDto,
  toAttributeDto,
} = require('../dto/assetTypes.dto');
const assetTypes = require('../../repositories/assetTypes.repo');

const router = express.Router();

/*
 * Asset types (US17) and their custom attributes (US18). Mirrored by
 * frontend/src/features/asset-types/api/assetTypes.api.ts:
 *
 *   POST /api/asset-types  { code, name } -> 201 { code, name }
 *                          | 409 DUPLICATE_CODE (fields.code) | 409 DUPLICATE_NAME (fields.name)
 *                          | 422 VALIDATION_FAILED
 *   POST /api/asset-types/:code/attributes
 *                          { key, label, dataType, isRequired? }
 *                          -> 201 { key, label, dataType, isRequired, isActive }
 *                          | 404 NOT_FOUND (unknown or inactive type)
 *                          | 409 DUPLICATE_KEY (fields.key, inactive attributes included)
 *                          | 422 VALIDATION_FAILED
 *
 * `:code` is case-insensitive, like codes in bodies and filters.
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

router.post(
  '/:code/attributes',
  asyncHandler(async (req, res) => {
    const input = parseCreateAttribute(req.body);
    const attribute = await assetTypes.createAttribute(req.params.code.toUpperCase(), input);
    res.status(201).json(toAttributeDto(attribute));
  }),
);

module.exports = router;
