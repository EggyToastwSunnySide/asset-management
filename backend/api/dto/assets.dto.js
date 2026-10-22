/**
 * Asset DTOs (ADR-0005). Every asset has the same fixed columns (ADR-0001);
 * type, status and location travel as reference-data codes (see
 * GET /api/reference-data), and responses also carry their display names.
 */

const { checkBody, checkQuery } = require('../validation');
const { UUID } = require('../errors');

const ASSET_FIELDS = ['tag', 'name', 'type', 'status', 'location', 'purchaseDate', 'notes', 'extendedAttributes'];

/** Columns the list can be sorted by (S-02). `type`/`status`/`location` sort by display name. */
const SORT_KEYS = ['tag', 'name', 'type', 'status', 'location', 'purchaseDate', 'createdAt', 'updatedAt'];
const SORT_DIRECTIONS = ['asc', 'desc'];

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 500;

const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function readAssetFields(c, { tagRequired }) {
  return {
    tag: c.string('tag', {
      required: tagRequired,
      max: 64,
      pattern: TAG_PATTERN,
      patternMessage: 'Use letters, digits and . _ / - only, starting with a letter or digit',
    }),
    name: c.string('name', { max: 255 }),
    type: c.code('type'),
    status: c.code('status'),
    location: c.code('location'),
    purchaseDate: c.date('purchaseDate'),
    notes: c.string('notes', { required: false, max: 2000, fallback: null }),
    // Shape only; the values are checked against the type's attributes when saved (api/attributeValues.js).
    extendedAttributes: c.object('extendedAttributes', (child) => child.input, { required: false }),
  };
}

/** POST /api/assets body. */
function parseCreateAsset(body) {
  const c = checkBody(body, ASSET_FIELDS);
  return c.done(readAssetFields(c, { tagRequired: true }));
}

/**
 * PUT /api/assets/:id body — a full replacement (last write wins, ADR-0004).
 * `tag` may be sent back unchanged (the form round-trips it) but the schema
 * makes it immutable, so the repository rejects a different value.
 */
function parseUpdateAsset(body) {
  const c = checkBody(body, ASSET_FIELDS);
  return c.done(readAssetFields(c, { tagRequired: false }));
}

/** Reference-data fields the list can be filtered on. */
const FILTER_FIELDS = ['type', 'status', 'location'];

/** Every filter parameter name: search, each field, and each field's `…Not` exclusion. */
const FILTER_PARAMS = ['search', ...FILTER_FIELDS, ...FILTER_FIELDS.map((f) => f + 'Not')];

/**
 * Filters shared by the list (S-02) and the export (ADR-0008) — one
 * definition, so they cannot drift. Mirrors the UI's filter popover:
 *
 *   type=A&type=B      is A or B      (values of one field OR together)
 *   typeNot=C          is not C       (every exclusion applies)
 *   type=…&status=…    both match     (different fields AND together)
 *   search=…           tag or name contains the text, case-insensitively
 */
function readFilters(c) {
  const filters = { search: c.string('search', { required: false, max: 100 }) };
  for (const field of FILTER_FIELDS) {
    filters[field] = c.codes(field);
    filters[field + 'Not'] = c.codes(field + 'Not');
  }
  return filters;
}

function readSort(c, keyField, directionField) {
  return {
    key: c.oneOf(keyField, SORT_KEYS, { required: false, fallback: 'tag' }),
    direction: c.oneOf(directionField, SORT_DIRECTIONS, { required: false, fallback: 'asc' }),
  };
}

/**
 * GET /api/assets query (ADR-0003): page, pageSize, sort, direction, plus
 * the filters above. Everything lives in the query string so the UI can
 * mirror it into its URL and survive a reload (S-02).
 */
function parseListQuery(query) {
  const c = checkQuery(query);
  return c.done({
    filters: readFilters(c),
    sort: readSort(c, 'sort', 'direction'),
    page: c.integer('page', { min: 1, fallback: 1 }),
    pageSize: c.integer('pageSize', { min: 1, max: MAX_PAGE_SIZE, fallback: DEFAULT_PAGE_SIZE }),
  });
}

function toAssetDto(row) {
  return {
    id: row.id,
    tag: row.tag,
    name: row.name,
    type: row.type,
    typeName: row.type_name,
    status: row.status,
    statusName: row.status_name,
    location: row.location,
    locationName: row.location_name,
    purchaseDate: row.purchase_date,
    notes: row.notes,
    extendedAttributes: row.extended_attributes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * US13-T1 replacement lifecycle rules, kept here only. Not yet agreed by the
 * team (Sprint 3 plan §1.10 Q2); the PR lists them under "Assumptions to confirm".
 * The repo has no Broken or Maintenance status yet, so only AVAILABLE old assets qualify.
 */
const REPLACEMENT_RULES = Object.freeze({
  oldAssetStatuses: Object.freeze(['AVAILABLE']),
  newAssetStatuses: Object.freeze(['AVAILABLE']),
  oldAssetResultStatus: 'REPLACED',
});

/** POST /api/assets/:id/replacement body (US13-T4); the asset at :id is the old one. */
function parseReplacement(body) {
  const c = checkBody(body, ['replacementAssetId', 'replacedOn', 'reason']);
  const replacementAssetId = c.string('replacementAssetId', {
    max: 36,
    pattern: UUID,
    patternMessage: 'Must be an asset id',
  });
  return c.done({
    replacementAssetId: replacementAssetId && replacementAssetId.toLowerCase(),
    replacedOn: c.date('replacedOn'),
    reason: c.string('reason', { max: 2000 }),
  });
}

function toReplacementDto(row) {
  return {
    id: row.id,
    oldAssetId: row.old_asset_id,
    newAssetId: row.new_asset_id,
    replacedOn: row.replaced_on,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

/** One activity-history entry (US16-AC3): action, acting user and timestamp. */
function toAssetEventDto(row) {
  return {
    id: row.id,
    type: row.event_type,
    occurredAt: row.occurred_at,
    actor: row.actor_id ? { id: row.actor_id, displayName: row.actor_name } : null,
    description: row.description,
    details: row.details,
  };
}

module.exports = {
  FILTER_FIELDS,
  FILTER_PARAMS,
  SORT_KEYS,
  DEFAULT_PAGE_SIZE,
  SORT_DIRECTIONS,
  MAX_PAGE_SIZE,
  REPLACEMENT_RULES,
  parseCreateAsset,
  parseUpdateAsset,
  parseListQuery,
  parseReplacement,
  readFilters,
  readSort,
  toAssetDto,
  toAssetEventDto,
  toReplacementDto,
};
