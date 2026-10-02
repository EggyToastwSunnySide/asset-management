import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.SIGN_IN_RATE_LIMIT_MAX = '2';
process.env.SIGN_IN_RATE_LIMIT_WINDOW_SECONDS = '60';

const require = createRequire(import.meta.url);
const { recreateTestDatabase } = require('./helpers/testDb');
const skip = await recreateTestDatabase();

let server;
let baseUrl;
let pool;

describe('sign-in rate limiting', { skip: skip || false }, () => {
  before(async () => {
    const app = require('../app');
    pool = require('../db/pool').pool;
    await require('../services/provisioning.service').provisionUser({
      email: 'rate-limit@example.test',
      displayName: 'Rate Limit User',
      password: 'Rate limit password 1',
      bootstrapAdmin: true,
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  async function failSignIn() {
    const response = await fetch(baseUrl + '/auth/sign-in', {
      method: 'POST',
      headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rate-limit@example.test', password: 'Wrong password 123' }),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }

  test('repeated failures return RATE_LIMITED and Retry-After', async () => {
    assert.equal((await failSignIn()).status, 401);
    assert.equal((await failSignIn()).status, 401);
    const limited = await failSignIn();
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'RATE_LIMITED');
    assert.ok(Number(limited.headers.get('retry-after')) > 0);

    const deadline = Date.now() + 2000;
    let audit = { rows: [] };
    while (Date.now() < deadline) {
      audit = await pool.query(
        `SELECT details::text AS details
           FROM fw_security_events
          WHERE event_type = 'security.rate_limited'`,
      );
      if (audit.rows.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(audit.rows.length > 0, true);
    assert.ok(audit.rows.every((row) => !row.details.toLowerCase().includes('password')));
  });
});

if (skip) console.log('# rate-limit integration test skipped: ' + skip);
