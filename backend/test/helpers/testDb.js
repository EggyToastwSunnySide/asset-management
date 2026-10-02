const { Client } = require('pg');
const { runMigrations } = require('../../db/migrate');

const TEST_DB_NAME = process.env.TEST_DB_NAME || 'asset_management_test';

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

/** Returns null when ready, or a reason string when PostgreSQL is unreachable. */
async function recreateTestDatabase() {
  const admin = new Client(connectionFor('postgres'));
  try {
    await admin.connect();
  } catch (err) {
    return `PostgreSQL not reachable (${err.code || err.message}); start it with \`docker compose up -d db\``;
  }
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }

  process.env.NODE_ENV = 'test';
  process.env.DB_NAME = TEST_DB_NAME;
  process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || 'http://localhost:5173';
  process.env.CSRF_SECRET = process.env.CSRF_SECRET || 'test-only-csrf-secret-at-least-thirty-two-characters';
  process.env.SIGN_IN_RATE_LIMIT_MAX = process.env.SIGN_IN_RATE_LIMIT_MAX || '1000';
  process.env.API_RATE_LIMIT_MAX = process.env.API_RATE_LIMIT_MAX || '100000';
  process.env.AUTH_LOCKOUT_MAX_FAILURES = process.env.AUTH_LOCKOUT_MAX_FAILURES || '3';

  await runMigrations(connectionFor(TEST_DB_NAME));
  return null;
}

module.exports = { TEST_DB_NAME, connectionFor, recreateTestDatabase };
