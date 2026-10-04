/**
 * Database-level guards that no API exposes yet: custom attribute
 * definitions and asset extended attributes (US18-T2). Runs straight SQL
 * against a freshly built test database; skipped when PostgreSQL is not reachable.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { recreateTestDatabase } = require('./helpers/testDb');

const skip = await recreateTestDatabase();

let pool;

async function rejects(sql, params, expected) {
  await assert.rejects(pool.query(sql, params), (err) => {
    assert.equal(err.code, expected.code, err.message);
    if (expected.constraint) assert.equal(err.constraint, expected.constraint);
    return true;
  });
}

async function typeId(code) {
  const { rows } = await pool.query('SELECT id FROM asset_types WHERE code = $1', [code]);
  return rows[0].id;
}

function addAttribute(assetTypeId, key, { label = 'Label', isActive = true } = {}) {
  return pool.query(
    `INSERT INTO asset_type_attributes (asset_type_id, key, label, data_type, is_active)
     VALUES ($1, $2, $3, 'text', $4) RETURNING id`,
    [assetTypeId, key, label, isActive],
  );
}

describe('US18-T2 custom attribute schema', { skip: skip || false }, () => {
  let laptop;
  let desktop;

  before(async () => {
    pool = require('../db/pool').pool;
    laptop = await typeId('LAPTOP');
    desktop = await typeId('DESKTOP');
  });

  after(async () => {
    await pool.end();
  });

  test('rejects a duplicate key on the same type, even when the first is inactive', async () => {
    await addAttribute(laptop, 'cpu');
    await addAttribute(laptop, 'old_port', { isActive: false });

    for (const key of ['cpu', 'old_port']) {
      await rejects(
        `INSERT INTO asset_type_attributes (asset_type_id, key, label, data_type) VALUES ($1, $2, 'X', 'text')`,
        [laptop, key],
        { code: '23505', constraint: 'uq_asset_type_attributes_key' },
      );
    }
  });

  test('allows the same key on two different types', async () => {
    await addAttribute(laptop, 'serial');
    await addAttribute(desktop, 'serial');
  });

  test('rejects a key outside ^[a-z][a-z0-9_]*$', async () => {
    for (const key of ['RAM', '1ram', '_ram', 'ram-gb', 'ram gb', '']) {
      await rejects(
        `INSERT INTO asset_type_attributes (asset_type_id, key, label, data_type) VALUES ($1, $2, 'X', 'text')`,
        [laptop, key],
        { code: '23514', constraint: 'ck_asset_type_attributes_key' },
      );
    }
  });

  test('rejects a blank label', async () => {
    await rejects(
      `INSERT INTO asset_type_attributes (asset_type_id, key, label, data_type) VALUES ($1, 'blank', '  ', 'text')`,
      [laptop],
      { code: '23514', constraint: 'ck_asset_type_attributes_label_nonblank' },
    );
  });

  test('rejects changing a key, but allows editing label, required and active', async () => {
    const { rows } = await addAttribute(laptop, 'ram_gb');
    const id = rows[0].id;

    await rejects("UPDATE asset_type_attributes SET key = 'ram' WHERE id = $1", [id], { code: '23000' });

    const updated = await pool.query(
      `UPDATE asset_type_attributes SET label = 'RAM (GB)', is_required = true, is_active = false
        WHERE id = $1 RETURNING key, updated_at > created_at AS touched`,
      [id],
    );
    assert.deepEqual(updated.rows[0], { key: 'ram_gb', touched: true });
  });

  test('extended_attributes defaults to {} and must be a JSON object', async () => {
    const user = await pool.query(
      `INSERT INTO fw_users (email, password_hash, display_name) VALUES ('schema@test.local', 'x', 'Schema') RETURNING id`,
    );
    const insertAsset = (tag, extended) =>
      pool.query(
        `INSERT INTO assets (asset_tag, name, asset_type_id, asset_status_id, location_id, purchase_date,
                             created_by_user_id, updated_by_user_id, extended_attributes)
         SELECT $1, 'Schema asset', $2, s.id, l.id, '2024-01-15', $3, $3, COALESCE($4::jsonb, '{}'::jsonb)
           FROM asset_statuses s, locations l WHERE s.code = 'AVAILABLE' AND l.code = 'HQ'
         RETURNING extended_attributes`,
        [tag, laptop, user.rows[0].id, extended],
      );

    assert.deepEqual((await insertAsset('SCH-1', null)).rows[0].extended_attributes, {});
    assert.deepEqual((await insertAsset('SCH-2', '{"ram_gb": 16}')).rows[0].extended_attributes, { ram_gb: 16 });

    for (const value of ['[]', '"text"', '1', 'null']) {
      await rejects(
        `INSERT INTO assets (asset_tag, name, asset_type_id, asset_status_id, location_id, purchase_date,
                             created_by_user_id, updated_by_user_id, extended_attributes)
         SELECT 'SCH-BAD', 'Bad', $1, s.id, l.id, '2024-01-15', $2, $2, $3::jsonb
           FROM asset_statuses s, locations l WHERE s.code = 'AVAILABLE' AND l.code = 'HQ'`,
        [laptop, user.rows[0].id, value],
        { code: '23514', constraint: 'ck_assets_extended_attributes_object' },
      );
    }
  });
});

if (skip) console.log('# schema tests skipped: ' + skip);
