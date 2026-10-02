const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const ADVISORY_LOCK_KEY = '6861737365746';

function loadMigrations(directory = MIGRATIONS_DIR) {
  return fs
    .readdirSync(directory)
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .map((name) => {
      const version = Number.parseInt(name.slice(0, name.indexOf('_')), 10);
      const sql = fs.readFileSync(path.join(directory, name), 'utf8');
      return {
        version,
        name,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      };
    });
}

function assertMigrationSequence(migrations) {
  const versions = new Set();
  let previous = 0;
  for (const migration of migrations) {
    if (versions.has(migration.version)) throw new Error(`Duplicate migration version ${migration.version}`);
    if (migration.version <= previous) throw new Error('Migration files are not in ascending version order');
    versions.add(migration.version);
    previous = migration.version;
  }
}

async function baselineLegacySchema(client, migrations) {
  const history = await client.query('SELECT count(*)::int AS count FROM fw_schema_migrations');
  if (history.rows[0].count !== 0) return;

  const existing = await client.query("SELECT to_regclass('public.assets') AS assets");
  if (!existing.rows[0].assets) return;

  const core = migrations.find((migration) => migration.version === 1);
  if (!core) throw new Error('The core-schema migration is required to baseline a legacy database');

  const required = await client.query(
    `SELECT to_regclass('public.fw_users') IS NOT NULL AS users,
            to_regclass('public.asset_events') IS NOT NULL AS events,
            to_regclass('public.export_profiles') IS NOT NULL AS profiles`,
  );
  if (!required.rows[0].users || !required.rows[0].events || !required.rows[0].profiles) {
    throw new Error('Refusing to baseline an incomplete legacy asset-management schema');
  }

  await client.query(
    `INSERT INTO fw_schema_migrations (version, name, checksum)
     VALUES ($1, $2, $3)`,
    [core.version, core.name, core.checksum],
  );

  const seed = migrations.find((migration) => migration.version === 2);
  if (!seed) return;
  const seeded = await client.query(
    `SELECT EXISTS (SELECT 1 FROM asset_types WHERE code = 'LAPTOP')
        AND EXISTS (SELECT 1 FROM asset_statuses WHERE code = 'AVAILABLE')
        AND EXISTS (SELECT 1 FROM locations WHERE code = 'HQ') AS complete`,
  );
  if (seeded.rows[0].complete) {
    await client.query(
      `INSERT INTO fw_schema_migrations (version, name, checksum)
       VALUES ($1, $2, $3)`,
      [seed.version, seed.name, seed.checksum],
    );
  }
}

async function runMigrations(connection, options = {}) {
  const migrations = loadMigrations(options.directory);
  assertMigrationSequence(migrations);

  const client = options.client || new Client(connection);
  const ownsClient = !options.client;
  if (ownsClient) await client.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [ADVISORY_LOCK_KEY]);
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS fw_schema_migrations (
           version integer PRIMARY KEY,
           name varchar(255) NOT NULL UNIQUE,
           checksum char(64) NOT NULL,
           applied_at timestamptz NOT NULL DEFAULT now(),
           CONSTRAINT ck_fw_schema_migrations_checksum CHECK (checksum ~ '^[0-9a-f]{64}$')
         )`,
      );

      await client.query('BEGIN');
      try {
        await baselineLegacySchema(client, migrations);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }

      const appliedResult = await client.query(
        'SELECT version, name, checksum FROM fw_schema_migrations ORDER BY version',
      );
      const applied = new Map(appliedResult.rows.map((row) => [row.version, row]));
      const known = new Map(migrations.map((migration) => [migration.version, migration]));

      for (const row of appliedResult.rows) {
        const migration = known.get(row.version);
        if (!migration) throw new Error(`Database contains unknown migration version ${row.version} (${row.name})`);
        if (row.name !== migration.name || row.checksum.trim() !== migration.checksum) {
          throw new Error(`Migration checksum mismatch for ${migration.name}; applied migrations are immutable`);
        }
      }

      for (const migration of migrations) {
        if (applied.has(migration.version)) continue;
        await client.query('BEGIN');
        try {
          await client.query(migration.sql);
          await client.query(
            `INSERT INTO fw_schema_migrations (version, name, checksum)
             VALUES ($1, $2, $3)`,
            [migration.version, migration.name, migration.checksum],
          );
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          err.message = `Migration ${migration.name} failed: ${err.message}`;
          throw err;
        }
      }

      return migrations.length;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [ADVISORY_LOCK_KEY]).catch(() => {});
    }
  } finally {
    if (ownsClient) await client.end();
  }
}

module.exports = { ADVISORY_LOCK_KEY, loadMigrations, runMigrations };
