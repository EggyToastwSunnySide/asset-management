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

module.exports = { createAssetType, createAttribute };
