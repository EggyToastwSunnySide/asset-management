import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { recreateTestDatabase } = require('./helpers/testDb');
const skip = await recreateTestDatabase();

const ORIGIN = 'http://localhost:5173';
const ADMIN_PASSWORD = 'Administrator password 1';
const STANDARD_PASSWORD = 'Standard user password 1';

let server;
let baseUrl;
let pool;
let provisionUser;
let adminUser;
let viewerUser;
let managerUser;
let noRoleUser;
let delegateUser;
let profileOwner;
let adminClient;

class ApiClient {
  constructor() {
    this.cookie = null;
    this.csrfToken = null;
  }

  async request(method, path, body, options = {}) {
    const headers = { Origin: options.origin === undefined ? ORIGIN : options.origin };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookie && options.auth !== false) headers.Cookie = this.cookie;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && path !== '/auth/sign-in') {
      if (options.csrf !== false) headers['X-CSRF-Token'] = options.csrf || this.csrfToken;
    }
    if (options.headers) Object.assign(headers, options.headers);
    if (headers.Origin === null) delete headers.Origin;

    const response = await fetch(baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = response.headers.get('content-type') || '';
    const parsed = response.status === 204
      ? null
      : type.includes('json')
        ? await response.json()
        : Buffer.from(await response.arrayBuffer());
    return { status: response.status, body: parsed, headers: response.headers };
  }

  async signIn(email, password) {
    const response = await this.request('POST', '/auth/sign-in', { email, password }, { auth: false });
    if (response.status === 200) {
      this.cookie = response.headers.get('set-cookie').split(';', 1)[0];
      this.csrfToken = response.body.csrfToken;
    }
    return response;
  }
}

async function assignSystemRole(userId, systemKey) {
  await pool.query(
    `INSERT INTO fw_user_roles (user_id, role_id)
     SELECT $1, id FROM fw_roles WHERE system_key = $2`,
    [userId, systemKey],
  );
}

async function provision(email, displayName, options = {}) {
  return provisionUser({
    email,
    displayName,
    password: options.password || STANDARD_PASSWORD,
    bootstrapAdmin: Boolean(options.bootstrapAdmin),
  });
}

async function waitForEvent(eventType, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      "SELECT count(*)::int AS count FROM fw_security_events WHERE event_type = $1",
      [eventType],
    );
    if (rows[0].count > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

function sampleAsset(tag) {
  return {
    tag,
    name: 'Asset ' + tag,
    type: 'LAPTOP',
    status: 'AVAILABLE',
    location: 'HQ',
    purchaseDate: '2024-01-15',
  };
}

describe('US-14 authentication and US-15 RBAC', { skip: skip || false }, () => {
  before(async () => {
    const app = require('../app');
    pool = require('../db/pool').pool;
    provisionUser = require('../services/provisioning.service').provisionUser;

    adminUser = await provision('admin@example.test', 'System Admin', {
      password: ADMIN_PASSWORD,
      bootstrapAdmin: true,
    });
    viewerUser = await provision('viewer@example.test', 'Viewer User');
    await assignSystemRole(viewerUser.id, 'viewer');
    managerUser = await provision('manager@example.test', 'Manager User');
    await assignSystemRole(managerUser.id, 'asset_manager');
    noRoleUser = await provision('norole@example.test', 'No Role User');
    delegateUser = await provision('delegate@example.test', 'Delegate User');
    profileOwner = await provision('profile.owner@example.test', 'Profile Owner');
    await assignSystemRole(profileOwner.id, 'asset_manager');

    const inactive = await provision('inactive@example.test', 'Inactive User');
    await pool.query('UPDATE fw_users SET is_active = false WHERE id = $1', [inactive.id]);
    const locked = await provision('locked@example.test', 'Locked User');
    await pool.query("UPDATE fw_users SET locked_until = now() + interval '1 hour' WHERE id = $1", [locked.id]);
    await pool.query(
      `INSERT INTO fw_users (email, password_hash, display_name, is_active)
       VALUES ('legacy@example.test', '!', 'Legacy Sentinel', true)`,
    );
    await provision('spaces@example.test', 'Exact Password User', { password: '  Exact password 123  ' });

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    adminClient = new ApiClient();
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  test('migrations seed the exact permission catalogue and immutable built-in role matrix', async () => {
    const migrations = await pool.query('SELECT version, length(checksum) AS checksum_length FROM fw_schema_migrations ORDER BY version');
    assert.deepEqual(migrations.rows.map((row) => row.version), [1, 2, 3, 4, 5]);
    assert.ok(migrations.rows.every((row) => row.checksum_length === 64));

    const permissions = await pool.query('SELECT permission_key FROM fw_permissions ORDER BY permission_key');
    assert.deepEqual(
      permissions.rows.map((row) => row.permission_key),
      [
        'assets.archive', 'assets.create', 'assets.restore', 'assets.update', 'assets.view',
        'exportProfiles.create', 'exportProfiles.delete', 'exportProfiles.update', 'exportProfiles.view',
        'exports.run', 'roles.assign', 'roles.create', 'roles.update', 'roles.view', 'users.view',
      ],
    );
    const roles = await pool.query(
      `SELECT r.system_key, array_agg(rp.permission_key ORDER BY rp.permission_key) AS permissions
         FROM fw_roles r
         JOIN fw_role_permissions rp ON rp.role_id = r.id
        WHERE r.system_key IS NOT NULL
        GROUP BY r.system_key
        ORDER BY r.system_key`,
    );
    assert.equal(roles.rows.find((row) => row.system_key === 'admin').permissions.length, 15);
    assert.equal(roles.rows.find((row) => row.system_key === 'asset_manager').permissions.length, 10);
    assert.deepEqual(roles.rows.find((row) => row.system_key === 'viewer').permissions, ['assets.view']);
  });

  test('provisioning creates no-role accounts by default and refuses a second bootstrap administrator', async () => {
    const noRoles = await pool.query('SELECT count(*)::int AS count FROM fw_user_roles WHERE user_id = $1', [noRoleUser.id]);
    assert.equal(noRoles.rows[0].count, 0);
    await assert.rejects(
      provision('second.bootstrap@example.test', 'Second Bootstrap', { bootstrapAdmin: true }),
      (error) => error.code === 'BOOTSTRAP_ADMIN_EXISTS',
    );
  });

  test('only the explicit public allowlist works without a session', async () => {
    const anonymous = new ApiClient();
    assert.equal((await anonymous.request('GET', '/health')).status, 200);
    assert.equal((await anonymous.request('GET', '/openapi.json')).status, 200);
    assert.equal((await anonymous.request('GET', '/docs/')).status, 200);
    const protectedResponse = await anonymous.request('GET', '/assets');
    assert.equal(protectedResponse.status, 401);
    assert.equal(protectedResponse.body.error.code, 'UNAUTHENTICATED');
    assert.equal(protectedResponse.headers.get('cache-control'), 'no-store');
  });

  test('every credential failure is the same generic 401', async () => {
    const attempts = [
      ['missing@example.test', STANDARD_PASSWORD],
      ['viewer@example.test', 'Wrong password 123'],
      ['inactive@example.test', STANDARD_PASSWORD],
      ['locked@example.test', STANDARD_PASSWORD],
      ['legacy@example.test', STANDARD_PASSWORD],
    ];
    for (const [email, password] of attempts) {
      const response = await new ApiClient().signIn(email, password);
      assert.equal(response.status, 401);
      assert.deepEqual(response.body, {
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  });

  test('repeated failures lock an account and the lock expires without extending', async () => {
    const target = await provision('lockout@example.test', 'Lockout User');
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await new ApiClient().signIn('lockout@example.test', 'Wrong password 123');
      assert.equal(response.status, 401);
      assert.equal(response.body.error.code, 'INVALID_CREDENTIALS');
    }

    const locked = await pool.query('SELECT locked_until FROM fw_users WHERE id = $1', [target.id]);
    assert.ok(locked.rows[0].locked_until > new Date());
    assert.equal(await waitForEvent('auth.account_locked'), true);

    const correctWhileLocked = await new ApiClient().signIn('lockout@example.test', STANDARD_PASSWORD);
    assert.equal(correctWhileLocked.status, 401);
    assert.equal(correctWhileLocked.body.error.code, 'INVALID_CREDENTIALS');

    const events = await pool.query(
      `SELECT count(*)::int AS count, max(details::text) AS details
         FROM fw_security_events
        WHERE event_type = 'auth.account_locked' AND target_user_id = $1`,
      [target.id],
    );
    assert.equal(events.rows[0].count, 1);
    assert.ok(!events.rows[0].details.includes('Wrong password'));

    await pool.query("UPDATE fw_users SET locked_until = now() - interval '1 second' WHERE id = $1", [target.id]);
    assert.equal((await new ApiClient().signIn('lockout@example.test', STANDARD_PASSWORD)).status, 200);
  });

  test('passwords are verified exactly without trimming', async () => {
    assert.equal((await new ApiClient().signIn('spaces@example.test', 'Exact password 123')).status, 401);
    assert.equal((await new ApiClient().signIn('spaces@example.test', '  Exact password 123  ')).status, 200);
  });

  test('sign-in sets the opaque cookie and session bootstrap returns the contract', async () => {
    const signedIn = await adminClient.signIn('admin@example.test', ADMIN_PASSWORD);
    assert.equal(signedIn.status, 200);
    assert.deepEqual(Object.keys(signedIn.body).sort(), ['csrfToken', 'permissions', 'roles', 'session', 'user']);
    assert.equal(signedIn.body.user.id, adminUser.id);
    assert.equal(signedIn.body.permissions.length, 15);
    assert.ok(signedIn.body.roles.some((role) => role.systemKey === 'admin'));
    const setCookie = signedIn.headers.get('set-cookie');
    assert.match(setCookie, /^asset_session=[A-Za-z0-9_-]{43};/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.doesNotMatch(setCookie, /Domain=/i);
    assert.doesNotMatch(setCookie, /Secure/);

    const restored = await adminClient.request('GET', '/auth/session');
    assert.equal(restored.status, 200);
    assert.equal(restored.body.csrfToken, signedIn.body.csrfToken);
    assert.deepEqual(restored.body.permissions, signedIn.body.permissions);
  });

  test('unsafe protected requests require both approved origin and session-bound CSRF', async () => {
    const without = await adminClient.request('POST', '/assets', sampleAsset('CSRF-1'), { csrf: false });
    assert.equal(without.status, 403);
    assert.equal(without.body.error.code, 'CSRF_FAILED');

    const wrong = await adminClient.request('POST', '/assets', sampleAsset('CSRF-2'), { csrf: 'wrong' });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.error.code, 'CSRF_FAILED');

    const origin = await adminClient.request('POST', '/assets', sampleAsset('CSRF-3'), {
      origin: 'https://evil.example',
    });
    assert.equal(origin.status, 403);
    assert.equal(origin.body.error.code, 'CSRF_FAILED');
  });

  test('rejected origins, CSRF failures and permission denials are audited without secrets', async () => {
    const rejectedSignIn = await new ApiClient().request(
      'POST',
      '/auth/sign-in',
      { email: 'admin@example.test', password: 'Wrong password 123' },
      { auth: false, origin: 'https://evil.example' },
    );
    assert.equal(rejectedSignIn.status, 403);
    assert.equal(rejectedSignIn.body.error.code, 'FORBIDDEN');

    const viewer = new ApiClient();
    assert.equal((await viewer.signIn('viewer@example.test', STANDARD_PASSWORD)).status, 200);
    assert.equal((await viewer.request('POST', '/assets', sampleAsset('AUDIT-1'))).status, 403);

    for (const eventType of ['security.origin_rejected', 'auth.csrf_failed', 'authz.permission_denied']) {
      assert.equal(await waitForEvent(eventType), true, `missing ${eventType}`);
    }

    const audited = await pool.query(
      `SELECT details::text AS details
         FROM fw_security_events
        WHERE event_type IN ('security.origin_rejected', 'auth.csrf_failed', 'authz.permission_denied')`,
    );
    for (const row of audited.rows) {
      assert.ok(!row.details.includes('Wrong password'));
      assert.ok(!row.details.toLowerCase().includes('password'));
      assert.ok(!row.details.includes(viewer.csrfToken));
    }
  });

  test('permission middleware enforces viewer, manager and no-role behavior', async () => {
    const viewer = new ApiClient();
    assert.equal((await viewer.signIn('viewer@example.test', STANDARD_PASSWORD)).status, 200);
    assert.equal((await viewer.request('GET', '/reference-data')).status, 200);
    const createDenied = await viewer.request('POST', '/assets', sampleAsset('VIEWER-1'));
    assert.equal(createDenied.status, 403);
    assert.equal(createDenied.body.error.code, 'FORBIDDEN');

    const manager = new ApiClient();
    assert.equal((await manager.signIn('manager@example.test', STANDARD_PASSWORD)).status, 200);
    assert.equal((await manager.request('POST', '/assets', sampleAsset('MANAGER-1'))).status, 201);

    const noRole = new ApiClient();
    const signedIn = await noRole.signIn('norole@example.test', STANDARD_PASSWORD);
    assert.equal(signedIn.status, 200);
    assert.deepEqual(signedIn.body.roles, []);
    assert.deepEqual(signedIn.body.permissions, []);
    assert.equal((await noRole.request('GET', '/assets')).status, 403);
  });

  test('asset-type reads and mutations use explicit asset permissions', async () => {
    const viewer = new ApiClient();
    assert.equal((await viewer.signIn('viewer@example.test', STANDARD_PASSWORD)).status, 200);
    assert.equal((await viewer.request('GET', '/asset-types/LAPTOP')).status, 200);
    assert.equal(
      (await viewer.request('POST', '/asset-types', { code: 'VIEWER_TYPE', name: 'Viewer type' })).status,
      403,
    );
    assert.equal(
      (await viewer.request('POST', '/asset-types/LAPTOP/attributes', {
        key: 'viewer_field',
        label: 'Viewer field',
        dataType: 'text',
      })).status,
      403,
    );

    const manager = new ApiClient();
    assert.equal((await manager.signIn('manager@example.test', STANDARD_PASSWORD)).status, 200);
    assert.equal(
      (await manager.request('POST', '/asset-types', { code: 'MANAGED_TYPE', name: 'Managed type' })).status,
      201,
    );
    assert.equal(
      (await manager.request('POST', '/asset-types/MANAGED_TYPE/attributes', {
        key: 'managed_field',
        label: 'Managed field',
        dataType: 'text',
      })).status,
      201,
    );

    // Editing, hiding and restoring need assets.update, which the viewer lacks.
    const path = '/asset-types/MANAGED_TYPE/attributes/managed_field';
    for (const [method, url, body] of [
      ['PUT', path, { label: 'Changed', dataType: 'text', isRequired: true }],
      ['DELETE', path],
      ['POST', path + '/restore'],
    ]) {
      assert.equal((await viewer.request(method, url, body)).status, 403, `${method} ${url}`);
    }
    const unchanged = await manager.request('GET', '/asset-types/MANAGED_TYPE/attributes?includeInactive=true');
    assert.deepEqual(unchanged.body, [
      { key: 'managed_field', label: 'Managed field', dataType: 'text', isRequired: false, isActive: true },
    ]);
  });

  test('access APIs expose no password/session secrets and built-in roles are immutable', async () => {
    const permissions = await adminClient.request('GET', '/permissions');
    assert.equal(permissions.status, 200);
    assert.equal(permissions.body.length, 15);

    const users = await adminClient.request('GET', '/users?search=viewer&page=1&pageSize=5');
    assert.equal(users.status, 200);
    assert.equal(users.body.total, 1);
    assert.equal(users.body.items[0].email, 'viewer@example.test');
    assert.equal('passwordHash' in users.body.items[0], false);
    assert.equal('password_hash' in users.body.items[0], false);

    const roles = await adminClient.request('GET', '/roles');
    const viewerRole = roles.body.find((role) => role.systemKey === 'viewer');
    const update = await adminClient.request('PUT', '/roles/' + viewerRole.id, {
      name: 'Changed',
      description: null,
      isActive: false,
      permissionKeys: [],
    });
    assert.equal(update.status, 409);
    assert.equal(update.body.error.code, 'SYSTEM_ROLE_IMMUTABLE');
  });

  let customRole;
  test('administrators can create custom roles and multiple roles form a permission union', async () => {
    const created = await adminClient.request('POST', '/roles', {
      name: 'Asset Creator',
      description: 'Can create assets',
      permissionKeys: ['assets.view', 'assets.create'],
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    customRole = created.body;

    const roles = await adminClient.request('GET', '/roles');
    const viewerRole = roles.body.find((role) => role.systemKey === 'viewer');
    const assigned = await adminClient.request('PUT', `/users/${noRoleUser.id}/roles`, {
      roleIds: [viewerRole.id, customRole.id],
    });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));

    const union = new ApiClient();
    const signedIn = await union.signIn('norole@example.test', STANDARD_PASSWORD);
    assert.deepEqual(signedIn.body.permissions, ['assets.create', 'assets.view']);
    assert.equal((await union.request('GET', '/assets')).status, 200);
    assert.equal((await union.request('POST', '/assets', sampleAsset('UNION-1'))).status, 201);
  });

  test('custom roles require the view permissions their actions depend on', async () => {
    const cases = [
      ['assets.create', ['assets.create'], 'assets.view'],
      ['assets.update', ['assets.update'], 'assets.view'],
      ['assets.archive', ['assets.archive'], 'assets.view'],
      ['assets.restore', ['assets.restore'], 'assets.view'],
      ['exports.run', ['exports.run'], 'assets.view'],
      ['exportProfiles.create', ['exportProfiles.create'], 'exportProfiles.view'],
      ['exportProfiles.update', ['exportProfiles.update'], 'exportProfiles.view'],
      ['exportProfiles.delete', ['exportProfiles.delete'], 'exportProfiles.view'],
      ['roles.create', ['roles.create'], 'roles.view'],
      ['roles.update', ['roles.update'], 'roles.view'],
      ['roles.assign', ['roles.assign', 'roles.view'], 'users.view'],
    ];

    for (const [name, permissionKeys, prerequisite] of cases) {
      const created = await adminClient.request('POST', '/roles', {
        name: `Invalid ${name}`,
        description: null,
        permissionKeys,
      });
      assert.equal(created.status, 422, JSON.stringify(created.body));
      assert.equal(created.body.error.code, 'VALIDATION_FAILED');
      assert.match(created.body.error.fields.permissionKeys, new RegExp(prerequisite.replace('.', '\\.')));
    }

    const valid = await adminClient.request('POST', '/roles', {
      name: 'Prerequisite-complete role',
      description: null,
      permissionKeys: ['assets.view', 'assets.create'],
    });
    assert.equal(valid.status, 201, JSON.stringify(valid.body));

    const invalidUpdate = await adminClient.request('PUT', `/roles/${valid.body.id}`, {
      name: valid.body.name,
      description: null,
      isActive: true,
      permissionKeys: ['assets.create'],
    });
    assert.equal(invalidUpdate.status, 422);
    assert.match(invalidUpdate.body.error.fields.permissionKeys, /assets\.view/);
  });

  test('role assignment rejects duplicates, unknown/inactive roles and self assignment', async () => {
    const roles = await adminClient.request('GET', '/roles');
    const viewerRole = roles.body.find((role) => role.systemKey === 'viewer');

    assert.equal(
      (await adminClient.request('PUT', `/users/${viewerUser.id}/roles`, { roleIds: [viewerRole.id, viewerRole.id] })).status,
      422,
    );
    assert.equal(
      (await adminClient.request('PUT', `/users/${viewerUser.id}/roles`, {
        roleIds: ['00000000-0000-4000-8000-000000000000'],
      })).status,
      422,
    );
    const inactive = await adminClient.request('POST', '/roles', {
      name: 'Inactive Assignment', description: null, permissionKeys: [],
    });
    await adminClient.request('PUT', '/roles/' + inactive.body.id, {
      name: inactive.body.name,
      description: null,
      isActive: false,
      permissionKeys: [],
    });
    assert.equal(
      (await adminClient.request('PUT', `/users/${viewerUser.id}/roles`, { roleIds: [inactive.body.id] })).status,
      422,
    );
    const self = await adminClient.request('PUT', `/users/${adminUser.id}/roles`, { roleIds: [] });
    assert.equal(self.status, 403);
  });

  test('callers cannot delegate permissions they do not possess', async () => {
    const assignerRole = await adminClient.request('POST', '/roles', {
      name: 'Limited Assigner',
      description: null,
      permissionKeys: ['roles.view', 'users.view', 'roles.assign'],
    });
    await adminClient.request('PUT', `/users/${delegateUser.id}/roles`, { roleIds: [assignerRole.body.id] });
    const delegate = new ApiClient();
    assert.equal((await delegate.signIn('delegate@example.test', STANDARD_PASSWORD)).status, 200);

    const roles = await adminClient.request('GET', '/roles');
    const managerRole = roles.body.find((role) => role.systemKey === 'asset_manager');
    const response = await delegate.request('PUT', `/users/${viewerUser.id}/roles`, { roleIds: [managerRole.id] });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'FORBIDDEN');
  });

  test('role changes and assignment changes revoke affected sessions', async () => {
    const roleUser = new ApiClient();
    assert.equal((await roleUser.signIn('norole@example.test', STANDARD_PASSWORD)).status, 200);
    const changed = await adminClient.request('PUT', '/roles/' + customRole.id, {
      name: 'Asset Editor',
      description: 'Updated',
      isActive: true,
      permissionKeys: ['assets.view', 'assets.update'],
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal((await roleUser.request('GET', '/assets')).status, 401);

    const manager = new ApiClient();
    assert.equal((await manager.signIn('manager@example.test', STANDARD_PASSWORD)).status, 200);
    const roles = await adminClient.request('GET', '/roles');
    const viewerRole = roles.body.find((role) => role.systemKey === 'viewer');
    assert.equal(
      (await adminClient.request('PUT', `/users/${managerUser.id}/roles`, { roleIds: [viewerRole.id] })).status,
      200,
    );
    assert.equal((await manager.request('GET', '/assets')).status, 401);
  });

  test('a full-permission delegate still cannot remove the final system administrator', async () => {
    const catalogue = await adminClient.request('GET', '/permissions');
    const fullRole = await adminClient.request('POST', '/roles', {
      name: 'Full Delegate',
      description: null,
      permissionKeys: catalogue.body.map((permission) => permission.key),
    });
    assert.equal(fullRole.status, 201);
    await adminClient.request('PUT', `/users/${delegateUser.id}/roles`, { roleIds: [fullRole.body.id] });

    const delegate = new ApiClient();
    assert.equal((await delegate.signIn('delegate@example.test', STANDARD_PASSWORD)).status, 200);
    const response = await delegate.request('PUT', `/users/${adminUser.id}/roles`, { roleIds: [] });
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'LAST_ADMIN_REQUIRED');
  });

  test('asset export requires both assets.view and exports.run', async () => {
    const exportOnlyUser = await provision('export.only@example.test', 'Export Only');
    const role = await pool.query(
      `INSERT INTO fw_roles (name, description) VALUES ('Legacy Export Only', null) RETURNING id`,
    );
    await pool.query(
      `INSERT INTO fw_role_permissions (role_id, permission_key) VALUES ($1, 'exports.run')`,
      [role.rows[0].id],
    );
    await pool.query(
      `INSERT INTO fw_user_roles (user_id, role_id) VALUES ($1, $2)`,
      [exportOnlyUser.id, role.rows[0].id],
    );
    const client = new ApiClient();
    assert.equal((await client.signIn('export.only@example.test', STANDARD_PASSWORD)).status, 200);
    const response = await client.request('POST', '/exports/assets', {});
    assert.equal(response.status, 403);
  });

  test('private export-profile identifiers remain owner-scoped 404s', async () => {
    const owner = new ApiClient();
    assert.equal((await owner.signIn('profile.owner@example.test', STANDARD_PASSWORD)).status, 200);
    const profile = await owner.request('POST', '/export-profiles', {
      name: 'Private profile',
      dateFormat: 'YYYY-MM-DD',
      columns: [{ key: 'tag', label: 'Tag', included: true }],
    });
    assert.equal(profile.status, 201);
    const crossOwner = await adminClient.request('GET', '/export-profiles/' + profile.body.id);
    assert.equal(crossOwner.status, 404);
  });

  test('idle expiry revokes the server-side session and returns UNAUTHENTICATED', async () => {
    const client = new ApiClient();
    assert.equal((await client.signIn('viewer@example.test', STANDARD_PASSWORD)).status, 200);
    const token = client.cookie.slice(client.cookie.indexOf('=') + 1);
    const { hashSessionToken } = require('../security/sessions');
    await pool.query(
      `UPDATE fw_sessions SET idle_expires_at = now() - interval '1 second' WHERE token_hash = $1`,
      [hashSessionToken(token)],
    );
    const response = await client.request('GET', '/assets');
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'UNAUTHENTICATED');
    const stored = await pool.query('SELECT revoked_reason FROM fw_sessions WHERE token_hash = $1', [hashSessionToken(token)]);
    assert.equal(stored.rows[0].revoked_reason, 'idle_expired');
  });

  test('absolute expiry is enforced independently of idle expiry', async () => {
    const client = new ApiClient();
    assert.equal((await client.signIn('profile.owner@example.test', STANDARD_PASSWORD)).status, 200);
    const token = client.cookie.slice(client.cookie.indexOf('=') + 1);
    const { hashSessionToken } = require('../security/sessions');
    await pool.query(
      `UPDATE fw_sessions
          SET created_at = now() - interval '1 hour',
              idle_expires_at = now() - interval '1 second',
              absolute_expires_at = now() - interval '1 second'
        WHERE token_hash = $1`,
      [hashSessionToken(token)],
    );
    assert.equal((await client.request('GET', '/auth/session')).status, 401);
    const stored = await pool.query('SELECT revoked_reason FROM fw_sessions WHERE token_hash = $1', [hashSessionToken(token)]);
    assert.equal(stored.rows[0].revoked_reason, 'absolute_expired');
  });

  test('sign-out revokes only the current session and clears the cookie', async () => {
    const first = new ApiClient();
    const second = new ApiClient();
    await first.signIn('viewer@example.test', STANDARD_PASSWORD);
    await second.signIn('viewer@example.test', STANDARD_PASSWORD);
    const signedOut = await first.request('POST', '/auth/sign-out');
    assert.equal(signedOut.status, 204);
    assert.match(signedOut.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
    assert.equal((await first.request('GET', '/auth/session')).status, 401);
    assert.equal((await second.request('GET', '/auth/session')).status, 200);
  });

  test('stale and revoked sessions are purged while active sessions survive', async () => {
    const { hashSessionToken } = require('../security/sessions');
    const active = new ApiClient();
    const stale = new ApiClient();
    const revoked = new ApiClient();
    assert.equal((await active.signIn('viewer@example.test', STANDARD_PASSWORD)).status, 200);
    assert.equal((await stale.signIn('viewer@example.test', STANDARD_PASSWORD)).status, 200);
    assert.equal((await revoked.signIn('viewer@example.test', STANDARD_PASSWORD)).status, 200);
    assert.equal((await revoked.request('POST', '/auth/sign-out')).status, 204);

    await pool.query(
      `UPDATE fw_sessions
          SET created_at = now() - interval '2 days',
              idle_expires_at = now() - interval '1 day',
              absolute_expires_at = now() - interval '1 day'
        WHERE token_hash = $1`,
      [hashSessionToken(stale.cookie.slice(stale.cookie.indexOf('=') + 1))],
    );

    const { purgeStaleSessions } = require('../repositories/auth.repo');
    assert.ok((await purgeStaleSessions(0)) >= 2);
    const remaining = await pool.query('SELECT count(*)::int AS count FROM fw_sessions WHERE token_hash = $1', [
      hashSessionToken(active.cookie.slice(active.cookie.indexOf('=') + 1)),
    ]);
    assert.equal(remaining.rows[0].count, 1);
  });

  test('security events are append-only and contain no raw session tokens', async () => {
    const events = await pool.query('SELECT id, event_type, details::text AS details FROM fw_security_events ORDER BY occurred_at');
    assert.ok(events.rows.some((event) => event.event_type === 'auth.sign_in_succeeded'));
    assert.ok(events.rows.some((event) => event.event_type === 'auth.sign_in_failed'));
    assert.ok(events.rows.some((event) => event.event_type === 'rbac.role_updated'));
    assert.ok(events.rows.every((event) => !event.details.includes('password')));
    await assert.rejects(
      pool.query("UPDATE fw_security_events SET event_type = 'tampered' WHERE id = $1", [events.rows[0].id]),
      /append-only/,
    );
  });
});

if (skip) console.log('# auth/RBAC integration tests skipped: ' + skip);
