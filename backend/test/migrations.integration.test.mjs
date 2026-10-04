import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Client } = require('pg');
const { loadMigrations, runMigrations } = require('../db/migrate');

const DATABASE = process.env.MIGRATION_TEST_DB_NAME || 'asset_management_migration_test';
const BOOTSTRAP_DATABASE = process.env.BOOTSTRAP_TEST_DB_NAME || 'asset_management_bootstrap_test';

function connectionFor(database) {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'asset_app',
    password: process.env.DB_PASSWORD || 'asset_app_dev',
    database,
    connectionTimeoutMillis: 3000,
  };
}

async function prepare() {
  const admin = new Client(connectionFor('postgres'));
  try {
    await admin.connect();
  } catch (err) {
    return `PostgreSQL not reachable (${err.code || err.message})`;
  }
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DATABASE}`);
  } finally {
    await admin.end();
  }

  const client = new Client(connectionFor(DATABASE));
  await client.connect();
  try {
    const migrationDirectory = path.join(__dirname, '..', 'db', 'migrations');
    await client.query(fs.readFileSync(path.join(migrationDirectory, '001_core_schema.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(migrationDirectory, '002_core_seed.sql'), 'utf8'));
    await client.query(
      `INSERT INTO fw_users (email, password_hash, display_name, role) VALUES
         ('legacy.manager@example.test', '!', 'Legacy Manager', 'asset_manager'),
         ('legacy.admin@example.test', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$YWJj', 'Legacy Admin', 'admin')`,
    );
  } finally {
    await client.end();
  }
  await runMigrations(connectionFor(DATABASE));
  return null;
}

const skip = await prepare();

test('legacy schemas are baselined, backfilled without changing user ids, and sentinel accounts are disabled', { skip: skip || false }, async () => {
  const client = new Client(connectionFor(DATABASE));
  await client.connect();
  try {
    const history = await client.query('SELECT version, checksum FROM fw_schema_migrations ORDER BY version');
    assert.deepEqual(history.rows.map((row) => row.version), [1, 2, 3, 4, 5]);
    assert.ok(history.rows.every((row) => row.checksum.trim().length === 64));

    const users = await client.query(
      `SELECT u.email::text AS email, u.is_active, u.role::text AS legacy_role, r.system_key
         FROM fw_users u
         JOIN fw_user_roles ur ON ur.user_id = u.id
         JOIN fw_roles r ON r.id = ur.role_id
        ORDER BY u.email`,
    );
    assert.deepEqual(users.rows, [
      { email: 'legacy.admin@example.test', is_active: true, legacy_role: 'admin', system_key: 'admin' },
      { email: 'legacy.manager@example.test', is_active: false, legacy_role: 'asset_manager', system_key: 'asset_manager' },
    ]);
  } finally {
    await client.end();
  }
});

test('built-in role permissions cannot be moved out of or into a system role', { skip: skip || false }, async () => {
  const client = new Client(connectionFor(DATABASE));
  await client.connect();
  try {
    const custom = await client.query(
      `INSERT INTO fw_roles (name, description) VALUES ('Migration guard role', null) RETURNING id`,
    );
    const adminPermission = await client.query(
      `SELECT rp.role_id, rp.permission_key
         FROM fw_role_permissions rp
         JOIN fw_roles r ON r.id = rp.role_id
        WHERE r.system_key = 'admin'
        ORDER BY rp.permission_key
        LIMIT 1`,
    );
    const { role_id: adminRoleId, permission_key: permissionKey } = adminPermission.rows[0];
    const customRoleId = custom.rows[0].id;

    await assert.rejects(
      client.query(
        `UPDATE fw_role_permissions SET role_id = $1 WHERE role_id = $2 AND permission_key = $3`,
        [customRoleId, adminRoleId, permissionKey],
      ),
      (err) => err.code === '23000',
    );

    await client.query(
      `INSERT INTO fw_role_permissions (role_id, permission_key) VALUES ($1, 'assets.view')`,
      [customRoleId],
    );
    await assert.rejects(
      client.query(
        `UPDATE fw_role_permissions SET role_id = $1 WHERE role_id = $2 AND permission_key = 'assets.view'`,
        [adminRoleId, customRoleId],
      ),
      (err) => err.code === '23000',
    );

    const rows = await client.query(
      `SELECT role_id, permission_key
         FROM fw_role_permissions
        WHERE (role_id = $1 AND permission_key = $3)
           OR (role_id = $2 AND permission_key = 'assets.view')
        ORDER BY role_id, permission_key`,
      [adminRoleId, customRoleId, permissionKey],
    );
    assert.equal(rows.rows.some((row) => row.role_id === adminRoleId && row.permission_key === permissionKey), true);
    assert.equal(rows.rows.some((row) => row.role_id === customRoleId && row.permission_key === 'assets.view'), true);
  } finally {
    await client.end();
  }
});

test('the advisory-locked migration runner is idempotent under concurrent startup', { skip: skip || false }, async () => {
  const results = await Promise.all([
    runMigrations(connectionFor(DATABASE)),
    runMigrations(connectionFor(DATABASE)),
    runMigrations(connectionFor(DATABASE)),
  ]);
  assert.deepEqual(results, [5, 5, 5]);
});

test('the Docker bootstrap schema can be baselined and migrated without recreating US-17 objects', { skip: skip || false }, async () => {
  const admin = new Client(connectionFor('postgres'));
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${BOOTSTRAP_DATABASE} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${BOOTSTRAP_DATABASE}`);
  } finally {
    await admin.end();
  }

  const client = new Client(connectionFor(BOOTSTRAP_DATABASE));
  try {
    await client.connect();
    const initDirectory = path.join(__dirname, '..', 'db', 'init');
    await client.query(fs.readFileSync(path.join(initDirectory, '001_schema.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(initDirectory, '002_seed.sql'), 'utf8'));

    assert.equal(await runMigrations(connectionFor(BOOTSTRAP_DATABASE)), 5);

    const verify = new Client(connectionFor(BOOTSTRAP_DATABASE));
    await verify.connect();
    try {
      const history = await verify.query('SELECT version FROM fw_schema_migrations ORDER BY version');
      assert.deepEqual(history.rows.map((row) => row.version), [1, 2, 3, 4, 5]);
      const schema = await verify.query(
        `SELECT to_regclass('public.asset_type_attributes') IS NOT NULL AS attributes,
                EXISTS (
                  SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public'
                     AND table_name = 'assets'
                     AND column_name = 'extended_attributes'
                ) AS extended_attributes`,
      );
      assert.deepEqual(schema.rows[0], { attributes: true, extended_attributes: true });
    } finally {
      await verify.end();
    }
  } finally {
    await client.end().catch(() => {});
    const cleanup = new Client(connectionFor('postgres'));
    await cleanup.connect();
    try {
      await cleanup.query(`DROP DATABASE IF EXISTS ${BOOTSTRAP_DATABASE} WITH (FORCE)`);
    } finally {
      await cleanup.end();
    }
  }
});

test('an applied migration checksum mismatch stops startup', { skip: skip || false }, async () => {
  const client = new Client(connectionFor(DATABASE));
  await client.connect();
  const migration = loadMigrations().find((item) => item.version === 3);
  try {
    await client.query("UPDATE fw_schema_migrations SET checksum = repeat('0', 64) WHERE version = 3");
    await assert.rejects(runMigrations(connectionFor(DATABASE)), /checksum mismatch/);
    await client.query('UPDATE fw_schema_migrations SET checksum = $1 WHERE version = 3', [migration.checksum]);
  } finally {
    await client.end();
  }
});

test.after(async () => {
  if (skip) return;
  const admin = new Client(connectionFor('postgres'));
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
});

if (skip) console.log('# migration integration tests skipped: ' + skip);
