/**
 * Asset type DTOs (US17, ADR-0005). A type is a reference-data row, so it
 * travels in the same `{ code, name }` shape as GET /api/reference-data's `types`.
 */

const { checkBody } = require('../validation');

const ASSET_TYPE_FIELDS = ['code', 'name'];

/** POST /api/asset-types body. `code` is trimmed and upper-cased (Checker.code). */
function parseCreateAssetType(body) {
  const c = checkBody(body, ASSET_TYPE_FIELDS);
  return c.done({
    code: c.code('code'),
    name: c.string('name', { max: 255 }),
  });
}

function toAssetTypeDto(row) {
  return { code: row.code, name: row.name };
}

module.exports = { parseCreateAssetType, toAssetTypeDto };
