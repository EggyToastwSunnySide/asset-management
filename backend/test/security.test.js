const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createSessionToken, hashSessionToken } = require('../security/sessions');
const { createCsrfToken, verifyCsrfToken } = require('../security/csrf');
const { validatePassword } = require('../security/passwords');

const backendDirectory = path.join(__dirname, '..');

function loadProductionConfig(overrides = {}) {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    ALLOWED_ORIGINS: 'https://assets.example.test',
    CSRF_SECRET: 'a-production-secret-with-more-than-thirty-two-characters',
    COOKIE_SECURE: 'true',
    ...overrides,
  };
  return spawnSync(
    process.execPath,
    ['-e', "const c=require('./config'); console.log(JSON.stringify(c.auth.cookie))"],
    { cwd: backendDirectory, env, encoding: 'utf8' },
  );
}

test('session tokens are random 256-bit opaque values and only fixed-size hashes need storage', () => {
  const first = createSessionToken();
  const second = createSessionToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.equal(hashSessionToken(first).length, 32);
  assert.notDeepEqual(hashSessionToken(first), hashSessionToken(second));
});

test('CSRF HMACs are bound to the session id', () => {
  const token = createCsrfToken('session-a');
  assert.equal(verifyCsrfToken('session-a', token), true);
  assert.equal(verifyCsrfToken('session-b', token), false);
  assert.equal(verifyCsrfToken('session-a', token + 'x'), false);
});

test('password length validation counts the exact untrimmed value', () => {
  assert.equal(validatePassword('short'), 'Password must be between 12 and 128 characters');
  assert.equal(validatePassword(' 1234567890 '), null);
  assert.equal(validatePassword('x'.repeat(129)), 'Password must be between 12 and 128 characters');
});

test('production config enforces a Secure __Host- cookie', () => {
  const result = loadProductionConfig();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    name: '__Host-asset_session',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
});

test('production rejects placeholder secrets, insecure origins and insecure cookies', () => {
  assert.notEqual(
    loadProductionConfig({ CSRF_SECRET: 'local-development-csrf-secret-change-before-production' }).status,
    0,
  );
  assert.notEqual(loadProductionConfig({ ALLOWED_ORIGINS: 'http://assets.example.test' }).status, 0);
  assert.notEqual(loadProductionConfig({ COOKIE_SECURE: 'false' }).status, 0);
});
