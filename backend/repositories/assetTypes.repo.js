/**
 * Asset type persistence (US17). Types are reference data: GET
 * /api/reference-data lists them, this module adds them.
 */

const db = require('../db/pool');
const { ApiError } = require('../api/errors');

/*
 * Unique constraint -> the input field it guards. The UNIQUE constraints are
 * the real check (a read-then-insert would race); this only words the 409.
 * Names are unique case-insensitively via the index on lower(name).
 */
const UNIQUE_FIELDS = {
  asset_types_code_key: 'code',
  uq_asset_types_name_ci: 'name',
  uq_asset_type_attributes_key: 'key',
};

const DUPLICATES = {
  code: (input) => ['DUPLICATE_CODE', `Asset type code "${input.code}" is already in use.`],
  name: (input) => ['DUPLICATE_NAME', `An asset type named "${input.name}" already exists.`],
  key: (input) => [
    'DUPLICATE_KEY',
    `Attribute key "${input.key}" is already used on this asset type, possibly by a hidden attribute. Keys cannot be reused.`,
  ],
};

function translateDuplicate(err, input) {
  const field = err.code === '23505' && UNIQUE_FIELDS[err.constraint];
  if (!field) return err;
  const [code, message] = DUPLICATES[field](input);
  return new ApiError(409, code, message, { [field]: message });
}

async function createAssetType(input) {
  try {
    const { rows } = await db.query(
      'INSERT INTO asset_types (code, name) VALUES ($1, $2) RETURNING code, name',
      [input.code, input.name],
    );
    return rows[0];
  } catch (err) {
    throw translateDuplicate(err, input);
  }
}

function assetTypeNotFound() {
  return new ApiError(404, 'NOT_FOUND', 'Asset type not found');
}

const ATTRIBUTE_COLUMNS = 'key, label, data_type, is_required, is_active';

/**
 * Adds a custom attribute (US18-T3) to the active type `typeCode`. The type is
 * resolved inside the INSERT, so an unknown or inactive code inserts nothing:
 * like resolveAssetCodes, a retired type cannot take new configuration.
 */
async function createAttribute(typeCode, input) {
  let rows;
  try {
    ({ rows } = await db.query(
      `INSERT INTO asset_type_attributes (asset_type_id, key, label, data_type, is_required)
       SELECT id, $2, $3, $4, $5 FROM asset_types WHERE code = $1 AND is_active
       RETURNING ${ATTRIBUTE_COLUMNS}`,
      [typeCode, input.key, input.label, input.dataType, input.isRequired],
    ));
  } catch (err) {
    throw translateDuplicate(err, input);
  }
  if (!rows[0]) throw assetTypeNotFound();
  return rows[0];
}

/**
 * The active type `typeCode` with its attributes in creation order (US17-T5):
 * `{ code, name, attributes }`. Hidden attributes only with `includeInactive`.
 */
async function getAssetTypeWithAttributes(typeCode, { includeInactive }) {
  const { rows: types } = await db.query(
    'SELECT id, code, name FROM asset_types WHERE code = $1 AND is_active',
    [typeCode],
  );
  const type = types[0];
  if (!type) throw assetTypeNotFound();
  const { rows: attributes } = await db.query(
    `SELECT ${ATTRIBUTE_COLUMNS} FROM asset_type_attributes
     WHERE asset_type_id = $1 AND (is_active OR $2)
     ORDER BY created_at, key`,
    [type.id, includeInactive],
  );
  return { code: type.code, name: type.name, attributes };
}

function attributeNotFound() {
  return new ApiError(404, 'NOT_FOUND', 'Attribute not found');
}

/** Picks attribute `$2` of the active type `$1`; an inactive type's attributes are not found. */
const ATTRIBUTE_OF_ACTIVE_TYPE = 'asset_type_id = (SELECT id FROM asset_types WHERE code = $1 AND is_active) AND key = $2';

/**
 * Replaces label, data type and required flag (US18-T4); hidden attributes too.
 * The data type is locked once any asset of the type holds a value for the key,
 * soft-deleted assets included, since a restore would bring the value back.
 */
async function updateAttribute(typeCode, key, input) {
  return db.withTransaction(async (client) => {
    // FOR UPDATE also waits for asset saves, which lock these rows FOR SHARE
    // (assets.repo.js), so a value cannot land between the count below and the
    // data type change.
    const { rows } = await client.query(
      `SELECT id, asset_type_id, data_type FROM asset_type_attributes WHERE ${ATTRIBUTE_OF_ACTIVE_TYPE} FOR UPDATE`,
      [typeCode, key],
    );
    const current = rows[0];
    if (!current) throw attributeNotFound();

    if (input.dataType !== current.data_type) {
      const { rows: counts } = await client.query(
        'SELECT count(*)::int AS n FROM assets WHERE asset_type_id = $1 AND extended_attributes ? $2',
        [current.asset_type_id, key],
      );
      const { n } = counts[0];
      if (n > 0) {
        const [noun, verb] = n === 1 ? ['asset', 'holds'] : ['assets', 'hold'];
        const message = `The data type cannot be changed: ${n} ${noun} of this type, deleted ones included, already ${verb} a value for "${key}".`;
        throw new ApiError(409, 'DATA_TYPE_LOCKED', message, { dataType: message });
      }
    }

    const { rows: updated } = await client.query(
      `UPDATE asset_type_attributes SET label = $2, data_type = $3, is_required = $4
       WHERE id = $1 RETURNING ${ATTRIBUTE_COLUMNS}`,
      [current.id, input.label, input.dataType, input.isRequired],
    );
    return updated[0];
  });
}

/**
 * Hides (`false`) or restores (`true`) an attribute (US18-T4). Never deletes the
 * row or touches assets.extended_attributes, so values survive a hide. Repeating
 * either is harmless.
 */
async function setAttributeActive(typeCode, key, isActive) {
  const { rows } = await db.query(
    `UPDATE asset_type_attributes SET is_active = $3 WHERE ${ATTRIBUTE_OF_ACTIVE_TYPE} RETURNING ${ATTRIBUTE_COLUMNS}`,
    [typeCode, key, isActive],
  );
  if (!rows[0]) throw attributeNotFound();
  return rows[0];
}

module.exports = {
  createAssetType,
  createAttribute,
  getAssetTypeWithAttributes,
  updateAttribute,
  setAttributeActive,
};
