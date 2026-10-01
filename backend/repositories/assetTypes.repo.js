/**
 * Asset type persistence (US17). Types are reference data: GET
 * /api/reference-data lists them, this module adds them.
 */

const db = require('../db/pool');
const { ApiError } = require('../api/errors');

/*
 * Unique constraint -> the input field it guards. The UNIQUE constraints are
 * the real check (a read-then-insert would race); this only words the 409.
 * `asset_types_name_key` is the default name of the case-insensitive
 * `name citext UNIQUE` planned for US17-T4; it never fires until that lands.
 */
const UNIQUE_FIELDS = {
  asset_types_code_key: 'code',
  asset_types_name_key: 'name',
};

const DUPLICATES = {
  code: (input) => ['DUPLICATE_CODE', `Asset type code "${input.code}" is already in use.`],
  name: (input) => ['DUPLICATE_NAME', `An asset type named "${input.name}" already exists.`],
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

module.exports = { createAssetType };
