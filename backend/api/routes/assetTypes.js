const express = require('express');
const { asyncHandler } = require('../errors');
const { requirePermissions } = require('../middleware/permissions');
const {
  parseCreateAssetType,
  parseCreateAttribute,
  parseUpdateAttribute,
  parseAttributeQuery,
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
 *   GET  /api/asset-types/:code             ?includeInactive=true|false
 *                          -> 200 { code, name, attributes: Attribute[] }   (creation order)
 *   GET  /api/asset-types/:code/attributes  ?includeInactive=true|false
 *                          -> 200 Attribute[]
 *                          | 404 NOT_FOUND (unknown or inactive type)
 *                          | 422 VALIDATION_FAILED (includeInactive is neither true nor false)
 *   PUT    /api/asset-types/:code/attributes/:key
 *                          { label, dataType, isRequired, key? } (full replace; hidden attributes too)
 *                          -> 200 Attribute
 *                          | 404 NOT_FOUND (unknown or inactive type, unknown key)
 *                          | 409 DATA_TYPE_LOCKED (fields.dataType: assets of the type, deleted
 *                            included, hold a value for the key)
 *                          | 422 VALIDATION_FAILED (fields.key when it differs from :key)
 *   DELETE /api/asset-types/:code/attributes/:key          -> 204, hides it (is_active = false)
 *   POST   /api/asset-types/:code/attributes/:key/restore  -> 200 Attribute, shows it again
 *                          Both keep the row and every asset value; repeating either is harmless.
 *
 * `:key` is matched exactly (keys are lower-case).
 * `:code` is case-insensitive, like codes in bodies and filters.
 * Listing stays in GET /api/reference-data (`types`).
 */

router.post(
  '/',
  requirePermissions('assets.view', 'assets.create'),
  asyncHandler(async (req, res) => {
    const input = parseCreateAssetType(req.body);
    const type = await assetTypes.createAssetType(input);
    res.status(201).json(toAssetTypeDto(type));
  }),
);

router.post(
  '/:code/attributes',
  requirePermissions('assets.view', 'assets.update'),
  asyncHandler(async (req, res) => {
    const input = parseCreateAttribute(req.body);
    const attribute = await assetTypes.createAttribute(req.params.code.toUpperCase(), input);
    res.status(201).json(toAttributeDto(attribute));
  }),
);

router.put(
  '/:code/attributes/:key',
  requirePermissions('assets.view', 'assets.update'),
  asyncHandler(async (req, res) => {
    const input = parseUpdateAttribute(req.body, req.params.key);
    const attribute = await assetTypes.updateAttribute(req.params.code.toUpperCase(), req.params.key, input);
    res.json(toAttributeDto(attribute));
  }),
);

router.delete(
  '/:code/attributes/:key',
  requirePermissions('assets.view', 'assets.update'),
  asyncHandler(async (req, res) => {
    await assetTypes.setAttributeActive(req.params.code.toUpperCase(), req.params.key, false);
    res.status(204).end();
  }),
);

router.post(
  '/:code/attributes/:key/restore',
  requirePermissions('assets.view', 'assets.update'),
  asyncHandler(async (req, res) => {
    const attribute = await assetTypes.setAttributeActive(req.params.code.toUpperCase(), req.params.key, true);
    res.json(toAttributeDto(attribute));
  }),
);

/** Both reads: the type named by `:code`, with the attributes `includeInactive` selects. */
function readType(req) {
  const { includeInactive } = parseAttributeQuery(req.query);
  return assetTypes.getAssetTypeWithAttributes(req.params.code.toUpperCase(), { includeInactive });
}

router.get(
  '/:code',
  requirePermissions('assets.view'),
  asyncHandler(async (req, res) => {
    const type = await readType(req);
    res.json({ ...toAssetTypeDto(type), attributes: type.attributes.map(toAttributeDto) });
  }),
);

router.get(
  '/:code/attributes',
  requirePermissions('assets.view'),
  asyncHandler(async (req, res) => {
    const type = await readType(req);
    res.json(type.attributes.map(toAttributeDto));
  }),
);

module.exports = router;
