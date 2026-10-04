/**
 * Asset persistence (S-01, S-02). Every read excludes soft-deleted rows
 * (ADR-0002) — through `buildWhere` for lists and exports and an explicit
 * `deleted_at IS NULL` everywhere else. Every write also appends to the
 * `asset_events` timeline in the same transaction.
 */

const { isDeepStrictEqual } = require('node:util');
const db = require('../db/pool');
const { ApiError } = require('../api/errors');
const { validationError } = require('../api/validation');
const { validateExtendedAttributes } = require('../api/attributeValues');
const { resolveAssetCodes } = require('./referenceData.repo');

const SELECT_ASSET = `
  SELECT a.id,
         a.asset_tag::text AS tag,
         a.name,
         t.code AS type,     t.name AS type_name,
         s.code AS status,   s.name AS status_name,
         l.code AS location, l.name AS location_name,
         a.purchase_date,
         a.notes,
         a.extended_attributes,
         a.created_at,
         a.updated_at,
         a.asset_type_id, a.asset_status_id, a.location_id
    FROM assets a
    JOIN asset_types    t ON t.id = a.asset_type_id
    JOIN asset_statuses s ON s.id = a.asset_status_id
    JOIN locations      l ON l.id = a.location_id`;

// Whitelist: sort keys map to SQL here and nowhere else, so user input never reaches ORDER BY.
const ORDER_COLUMNS = {
  tag: 'a.asset_tag',
  name: 'a.name',
  type: 't.name',
  status: 's.name',
  location: 'l.name',
  purchaseDate: 'a.purchase_date',
  createdAt: 'a.created_at',
  updatedAt: 'a.updated_at',
};

const FILTER_COLUMNS = [
  ['type', 't.code'],
  ['status', 's.code'],
  ['location', 'l.code'],
];

function escapeLike(term) {
  return term.replace(/[\\%_]/g, '\\$&');
}

/** WHERE clause for the list's filters (S-02); reused unchanged by the export (ADR-0008). */
function buildWhere(filters = {}) {
  const clauses = ['a.deleted_at IS NULL'];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    clauses.push(sql.replaceAll('?', '$' + params.length));
  };

  // Semantics in api/dto/assets.dto.js (readFilters): values of one field OR
  // together, exclusions all apply, different fields AND together.
  for (const [field, column] of FILTER_COLUMNS) {
    if (filters[field] && filters[field].length) add(`${column} = ANY(?)`, filters[field]);
    if (filters[field + 'Not'] && filters[field + 'Not'].length) {
      add(`${column} <> ALL(?)`, filters[field + 'Not']);
    }
  }
  // Free-text search on tag and name (S-02). asset_tag is citext; ILIKE covers name.
  if (filters.search) add('(a.asset_tag ILIKE ? OR a.name ILIKE ?)', '%' + escapeLike(filters.search) + '%');

  return { where: 'WHERE ' + clauses.join(' AND '), params };
}

/** Tag then id break ties, so paging is stable when many rows share a sort value. */
function buildOrderBy(sort = {}) {
  const column = ORDER_COLUMNS[sort.key] || ORDER_COLUMNS.tag;
  const direction = sort.direction === 'desc' ? 'DESC' : 'ASC';
  return `ORDER BY ${column} ${direction}, a.asset_tag ASC, a.id ASC`;
}

/** One page plus the total match count (ADR-0003). */
async function listAssets({ filters, sort, page, pageSize }) {
  const { where, params } = buildWhere(filters);
  const offset = (page - 1) * pageSize;

  const [countResult, pageResult] = await Promise.all([
    db.query(
      `SELECT count(*)::int AS total
         FROM assets a
         JOIN asset_types    t ON t.id = a.asset_type_id
         JOIN asset_statuses s ON s.id = a.asset_status_id
         JOIN locations      l ON l.id = a.location_id
       ${where}`,
      params,
    ),
    db.query(
      `${SELECT_ASSET} ${where} ${buildOrderBy(sort)}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    ),
  ]);

  return { items: pageResult.rows, total: countResult.rows[0].total, page, pageSize };
}

/** Every matching row in list order, without LIMIT/OFFSET — the export's row set (ADR-0008). */
async function listAllAssets({ filters, sort }) {
  const { where, params } = buildWhere(filters);
  const { rows } = await db.query(`${SELECT_ASSET} ${where} ${buildOrderBy(sort)}`, params);
  return rows;
}

async function findAsset(id, client = db) {
  const { rows } = await client.query(`${SELECT_ASSET} WHERE a.id = $1 AND a.deleted_at IS NULL`, [id]);
  return rows[0] || null;
}

function assetNotFound() {
  return new ApiError(404, 'NOT_FOUND', 'Asset not found');
}

function recordEvent(client, assetId, eventType, userId, description, details = {}) {
  return client.query(
    `INSERT INTO asset_events (asset_id, event_type, actor_user_id, description, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [assetId, eventType, userId, description, JSON.stringify(details)],
  );
}

async function resolveCodesOrThrow(client, input, keep) {
  const { ids, errors } = await resolveAssetCodes(client, input, keep);
  if (Object.keys(errors).length) throw validationError(errors);
  return ids;
}

/**
 * The type's attribute definitions, hidden ones included (US18-T6). FOR SHARE
 * holds off a concurrent data type change or hide until this save commits, so
 * the values are stored under the definitions they were checked against.
 */
async function attributeDefinitions(client, typeId) {
  const { rows } = await client.query(
    `SELECT key, data_type, is_required, is_active FROM asset_type_attributes
      WHERE asset_type_id = $1 FOR SHARE`,
    [typeId],
  );
  return rows;
}

/**
 * S-01: "a duplicate is rejected with a clear message". The UNIQUE constraint
 * is the real check (a read-then-insert would race); this only words the
 * error, including the case where a deleted asset still holds the tag
 * (ADR-0002 — tags are never reused).
 */
async function duplicateTagError(tag) {
  const { rows } = await db.query(
    'SELECT asset_tag::text AS tag, deleted_at IS NOT NULL AS deleted FROM assets WHERE asset_tag = $1',
    [tag],
  );
  const holder = rows[0];
  const message = holder && holder.deleted
    ? `Asset tag "${holder.tag}" belongs to a deleted asset. Restore that asset instead of creating a new one.`
    : `Asset tag "${holder ? holder.tag : tag}" is already in use.`;
  return new ApiError(409, 'DUPLICATE_TAG', message, { tag: message });
}

function isUniqueViolation(err, constraint) {
  return err.code === '23505' && err.constraint === constraint;
}

async function createAsset(input, userId) {
  try {
    return await db.withTransaction(async (client) => {
      const ids = await resolveCodesOrThrow(client, input);
      const extended = validateExtendedAttributes(
        input.extendedAttributes,
        await attributeDefinitions(client, ids.typeId),
      );
      const { rows } = await client.query(
        `INSERT INTO assets (asset_tag, name, asset_type_id, asset_status_id, purchase_date,
                             location_id, notes, extended_attributes, created_by_user_id, updated_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
         RETURNING id`,
        [
          input.tag, input.name, ids.typeId, ids.statusId, input.purchaseDate, ids.locationId, input.notes,
          JSON.stringify(extended), userId,
        ],
      );
      const id = rows[0].id;
      await recordEvent(client, id, 'created', userId, `Asset ${input.tag} created`);
      return findAsset(id, client);
    });
  } catch (err) {
    if (isUniqueViolation(err, 'assets_asset_tag_key')) throw await duplicateTagError(input.tag);
    throw err;
  }
}

const TRACKED_FIELDS = [
  ['name', 'name'],
  ['type', 'type'],
  ['status', 'status'],
  ['location', 'location'],
  ['purchaseDate', 'purchase_date'],
  ['notes', 'notes'],
];

/**
 * Full replacement; last write wins (ADR-0004), so there is no version check.
 * Custom attribute values are replaced too, except hidden ones, which keep their
 * stored value. A type change drops every value stored for the old type — keys
 * are per type — and the 'updated' event records what was dropped.
 */
async function updateAsset(id, input, userId) {
  return db.withTransaction(async (client) => {
    const { rows } = await client.query(
      `${SELECT_ASSET}
        WHERE a.id = $1 AND a.deleted_at IS NULL
          FOR UPDATE OF a`,
      [id],
    );
    const current = rows[0];
    if (!current) throw assetNotFound();

    // The schema makes asset_tag immutable (trigger); say so per field rather
    // than surfacing the trigger's error. Case-only differences are the same tag (citext).
    if (input.tag !== undefined && input.tag.toLowerCase() !== current.tag.toLowerCase()) {
      throw validationError({ tag: 'The asset tag cannot be changed once created' });
    }

    const ids = await resolveCodesOrThrow(client, input, {
      typeId: current.asset_type_id,
      statusId: current.asset_status_id,
      locationId: current.location_id,
    });

    const stored = current.extended_attributes;
    const typeChanged = ids.typeId !== current.asset_type_id;
    const extended = validateExtendedAttributes(
      input.extendedAttributes,
      await attributeDefinitions(client, ids.typeId),
      typeChanged ? {} : stored,
    );

    await client.query(
      `UPDATE assets
          SET name = $2, asset_type_id = $3, asset_status_id = $4, purchase_date = $5,
              location_id = $6, notes = $7, extended_attributes = $8, updated_by_user_id = $9
        WHERE id = $1`,
      [
        id, input.name, ids.typeId, ids.statusId, input.purchaseDate, ids.locationId, input.notes,
        JSON.stringify(extended), userId,
      ],
    );

    const changed = TRACKED_FIELDS.filter(([field, column]) => input[field] !== current[column]).map(
      ([field]) => field,
    );
    if (!isDeepStrictEqual(extended, stored)) changed.push('extendedAttributes');
    const details = { changed };
    if (typeChanged && Object.keys(stored).length) details.droppedAttributes = stored;
    if (changed.length) {
      await recordEvent(client, id, 'updated', userId, `Asset ${current.tag} updated`, details);
    }

    return findAsset(id, client);
  });
}

/** Soft delete (ADR-0002): stamps deleted_at. Deleting an already-deleted asset is a 404. */
async function softDeleteAsset(id, userId) {
  await db.withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE assets SET deleted_at = now(), updated_by_user_id = $2
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING asset_tag::text AS tag`,
      [id, userId],
    );
    if (!rows[0]) throw assetNotFound();
    await recordEvent(client, id, 'archived', userId, `Asset ${rows[0].tag} deleted`);
  });
}

/** Clears deleted_at. Restoring an asset that is not deleted is a no-op, so an undo can safely repeat. */
async function restoreAsset(id, userId) {
  return db.withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE assets SET deleted_at = NULL, updated_by_user_id = $2
        WHERE id = $1 AND deleted_at IS NOT NULL
        RETURNING asset_tag::text AS tag`,
      [id, userId],
    );
    if (rows[0]) {
      await recordEvent(client, id, 'restored', userId, `Asset ${rows[0].tag} restored`);
    } else {
      const exists = await client.query('SELECT 1 FROM assets WHERE id = $1', [id]);
      if (!exists.rowCount) throw assetNotFound();
    }
    return findAsset(id, client);
  });
}

module.exports = {
  listAssets,
  listAllAssets,
  findAsset,
  createAsset,
  updateAsset,
  softDeleteAsset,
  restoreAsset,
};
