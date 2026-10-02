/**
 * Asset type DTOs (US17, ADR-0005). A type is a reference-data row, so it
 * travels in the same `{ code, name }` shape as GET /api/reference-data's `types`.
 */

const { checkBody, checkQuery } = require('../validation');

const ASSET_TYPE_FIELDS = ['code', 'name'];
const ATTRIBUTE_FIELDS = ['key', 'label', 'dataType', 'isRequired'];

/** Values of the schema's attribute_data_type enum (US18-T1). */
const ATTRIBUTE_DATA_TYPES = ['text', 'number', 'date', 'boolean'];

/** Same as the schema's ck_asset_type_attributes_key; not lower-cased for the user, so they see the real key. */
const ATTRIBUTE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/** POST /api/asset-types body. `code` is trimmed and upper-cased (Checker.code). */
function parseCreateAssetType(body) {
  const c = checkBody(body, ASSET_TYPE_FIELDS);
  return c.done({
    code: c.code('code'),
    name: c.string('name', { max: 255 }),
  });
}

/** POST /api/asset-types/:code/attributes body (US18-T3). */
function parseCreateAttribute(body) {
  const c = checkBody(body, ATTRIBUTE_FIELDS);
  return c.done({
    key: c.string('key', {
      max: 32,
      pattern: ATTRIBUTE_KEY_PATTERN,
      patternMessage: 'Use lowercase letters, digits and _ only, starting with a letter',
    }),
    label: c.string('label', { max: 255 }),
    dataType: c.oneOf('dataType', ATTRIBUTE_DATA_TYPES),
    isRequired: c.has('isRequired') ? c.boolean('isRequired') : false,
  });
}

/**
 * GET /api/asset-types/:code (and /attributes) query (US17-T5). Only `true` or
 * `false`: a typo such as `yes` is a 422 rather than silently hiding attributes.
 */
function parseAttributeQuery(query) {
  const c = checkQuery(query);
  const includeInactive = c.oneOf('includeInactive', ['true', 'false'], { required: false, fallback: 'false' });
  return c.done({ includeInactive: includeInactive === 'true' });
}

function toAssetTypeDto(row) {
  return { code: row.code, name: row.name };
}

function toAttributeDto(row) {
  return {
    key: row.key,
    label: row.label,
    dataType: row.data_type,
    isRequired: row.is_required,
    isActive: row.is_active,
  };
}

module.exports = {
  ATTRIBUTE_DATA_TYPES,
  parseCreateAssetType,
  parseCreateAttribute,
  parseAttributeQuery,
  toAssetTypeDto,
  toAttributeDto,
};
