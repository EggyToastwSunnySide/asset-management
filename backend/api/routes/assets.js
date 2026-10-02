const express = require('express');
const { ApiError, asyncHandler, uuidParam } = require('../errors');
const { requirePermissions } = require('../middleware/permissions');
const { parseCreateAsset, parseUpdateAsset, parseListQuery, toAssetDto } = require('../dto/assets.dto');
const assets = require('../../repositories/assets.repo');

const router = express.Router();

/*
 * Asset register (S-01, S-02). Mirrored by
 * frontend/src/features/assets/api/assets.http.ts:
 *
 *   GET    /api/assets              ?page&pageSize&sort&direction&search&type&status&location
 *                                   -> 200 { items: Asset[], total, page, pageSize }   (ADR-0003)
 *   GET    /api/assets/:id          -> 200 Asset
 *   POST   /api/assets              AssetInput -> 201 Asset | 409 DUPLICATE_TAG       (ADR-0005)
 *   PUT    /api/assets/:id          AssetInput -> 200 Asset                           (ADR-0004, LWW)
 *   DELETE /api/assets/:id          -> 204, sets deleted_at                            (ADR-0002)
 *   POST   /api/assets/:id/restore  -> 200 Asset, clears deleted_at
 *
 * Deleted assets are invisible to every read: they 404 by id and never list.
 */

router.param('id', uuidParam('Asset'));

router.get(
  '/',
  requirePermissions('assets.view'),
  asyncHandler(async (req, res) => {
    const query = parseListQuery(req.query);
    const page = await assets.listAssets(query);
    res.json({ ...page, items: page.items.map(toAssetDto) });
  }),
);

router.get(
  '/:id',
  requirePermissions('assets.view'),
  asyncHandler(async (req, res) => {
    const asset = await assets.findAsset(req.params.id);
    if (!asset) throw new ApiError(404, 'NOT_FOUND', 'Asset not found');
    res.json(toAssetDto(asset));
  }),
);

router.post(
  '/',
  requirePermissions('assets.create'),
  asyncHandler(async (req, res) => {
    const input = parseCreateAsset(req.body);
    const asset = await assets.createAsset(input, req.user.id);
    res.status(201).location(req.baseUrl + '/' + asset.id).json(toAssetDto(asset));
  }),
);

router.put(
  '/:id',
  requirePermissions('assets.update'),
  asyncHandler(async (req, res) => {
    const input = parseUpdateAsset(req.body);
    const asset = await assets.updateAsset(req.params.id, input, req.user.id);
    res.json(toAssetDto(asset));
  }),
);

router.delete(
  '/:id',
  requirePermissions('assets.archive'),
  asyncHandler(async (req, res) => {
    await assets.softDeleteAsset(req.params.id, req.user.id);
    res.status(204).end();
  }),
);

router.post(
  '/:id/restore',
  requirePermissions('assets.restore'),
  asyncHandler(async (req, res) => {
    const asset = await assets.restoreAsset(req.params.id, req.user.id);
    res.json(toAssetDto(asset));
  }),
);

module.exports = router;
