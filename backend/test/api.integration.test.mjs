/**
 * End-to-end over HTTP against a freshly built test database, organised by
 * the stories' acceptance criteria. Skipped (with the reason printed) when
 * PostgreSQL is not reachable.
 *
 *   DB_PORT=55432 npm test     # compose db published on a non-default port
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { recreateTestDatabase } = require('./helpers/testDb');
const ExcelJS = require('exceljs');

const skip = await recreateTestDatabase();

let server;
let baseUrl;
let pool;
let sessionCookie;
let csrfToken;
const origin = 'http://localhost:5173';

async function api(method, path, body, options = {}) {
  const headers = { Origin: origin, ...(options.headers || {}) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (sessionCookie && options.auth !== false) headers.Cookie = sessionCookie;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && path !== '/auth/sign-in' && options.csrf !== false) {
    headers['X-CSRF-Token'] = csrfToken;
  }
  const res = await fetch(baseUrl + path, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, body: data };
}

function asset(tag, overrides = {}) {
  return {
    tag,
    name: 'Asset ' + tag,
    type: 'LAPTOP',
    status: 'AVAILABLE',
    location: 'HQ',
    purchaseDate: '2024-01-15',
    ...overrides,
  };
}

async function exportSheet(body) {
  const res = await api('POST', '/exports/assets', body);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.match(res.headers.get('content-type'), /spreadsheetml/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="inventory-export-\d{4}-\d{2}-\d{2}\.xlsx"/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(res.body);
  return { sheet: workbook.getWorksheet('Assets'), rowCount: Number(res.headers.get('x-export-row-count')) };
}

describe('asset management API', { skip: skip || false }, () => {
  before(async () => {
    const app = require('../app');
    pool = require('../db/pool').pool;
    const { hashPassword } = require('../security/passwords');
    const passwordHash = await hashPassword('Integration password 1');
    const created = await pool.query(
      `INSERT INTO fw_users (email, password_hash, display_name, role)
       VALUES ('integration.admin@example.test', $1, 'Integration Admin', 'admin')
       RETURNING id`,
      [passwordHash],
    );
    await pool.query(
      `INSERT INTO fw_user_roles (user_id, role_id)
       SELECT $1, id FROM fw_roles WHERE system_key = 'admin'`,
      [created.rows[0].id],
    );

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    const signedIn = await api(
      'POST',
      '/auth/sign-in',
      { email: 'integration.admin@example.test', password: 'Integration password 1' },
      { auth: false },
    );
    assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
    sessionCookie = signedIn.headers.get('set-cookie').split(';', 1)[0];
    csrfToken = signedIn.body.csrfToken;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  test('health reports the database as up', async () => {
    const res = await api('GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.database, 'up');
  });

  test('reference data lists seeded codes', async () => {
    const res = await api('GET', '/reference-data');
    assert.equal(res.status, 200);
    assert.ok(res.body.types.some((t) => t.code === 'LAPTOP'));
    assert.ok(res.body.statuses.some((s) => s.code === 'AVAILABLE'));
    assert.ok(res.body.locations.some((l) => l.code === 'HQ'));
  });

  describe('S-01 asset CRUD', () => {
    let created;

    test('creates an asset with all six attributes', async () => {
      const res = await api('POST', '/assets', asset('S01-001', { type: 'monitor', notes: '  ' }));
      assert.equal(res.status, 201);
      assert.match(res.headers.get('location'), /\/api\/assets\/[0-9a-f-]{36}$/);
      created = res.body;
      assert.equal(created.tag, 'S01-001');
      assert.equal(created.type, 'MONITOR');
      assert.ok(created.typeName);
      assert.equal(created.purchaseDate, '2024-01-15');
      assert.equal(created.notes, null);
    });

    test('reads it back by id', async () => {
      const res = await api('GET', '/assets/' + created.id);
      assert.equal(res.status, 200);
      assert.equal(res.body.tag, 'S01-001');
    });

    test('rejects a duplicate tag, case-insensitively, with a clear message', async () => {
      const res = await api('POST', '/assets', asset('s01-001'));
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'DUPLICATE_TAG');
      assert.match(res.body.error.fields.tag, /already in use/);
    });

    test('rejects invalid input with per-field messages', async () => {
      const res = await api('POST', '/assets', { tag: '', type: 'SPACESHIP', status: 'AVAILABLE', location: 'HQ' });
      assert.equal(res.status, 422);
      assert.ok(res.body.error.fields.tag);
      assert.ok(res.body.error.fields.name);
      assert.ok(res.body.error.fields.purchaseDate);
    });

    test('rejects an unknown reference code', async () => {
      const res = await api('POST', '/assets', asset('S01-002', { type: 'SPACESHIP' }));
      assert.equal(res.status, 422);
      assert.match(res.body.error.fields.type, /Unknown asset type/);
    });

    test('edits every editable field (last write wins)', async () => {
      const res = await api('PUT', '/assets/' + created.id, {
        tag: 'S01-001',
        name: 'Renamed',
        type: 'PRINTER',
        status: 'RETIRED',
        location: 'WAREHOUSE',
        purchaseDate: '2020-05-05',
        notes: 'Moved',
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.name, 'Renamed');
      assert.equal(res.body.type, 'PRINTER');
      assert.equal(res.body.status, 'RETIRED');
      assert.equal(res.body.location, 'WAREHOUSE');
      assert.equal(res.body.purchaseDate, '2020-05-05');
      assert.equal(res.body.notes, 'Moved');
    });

    test('refuses to change the immutable tag', async () => {
      const res = await api('PUT', '/assets/' + created.id, asset('OTHER-TAG'));
      assert.equal(res.status, 422);
      assert.match(res.body.error.fields.tag, /cannot be changed/);
    });

    test('deletes: the asset disappears from reads and the list', async () => {
      assert.equal((await api('DELETE', '/assets/' + created.id)).status, 204);
      assert.equal((await api('GET', '/assets/' + created.id)).status, 404);
      assert.equal((await api('PUT', '/assets/' + created.id, asset('S01-001'))).status, 404);
      assert.equal((await api('DELETE', '/assets/' + created.id)).status, 404);
      const list = await api('GET', '/assets?search=S01-001');
      assert.equal(list.body.total, 0);
    });

    test('a deleted asset still holds its tag', async () => {
      const res = await api('POST', '/assets', asset('S01-001'));
      assert.equal(res.status, 409);
      assert.match(res.body.error.message, /deleted asset/);
    });

    test('restores a deleted asset; restoring again is harmless', async () => {
      const res = await api('POST', `/assets/${created.id}/restore`);
      assert.equal(res.status, 200);
      assert.equal(res.body.name, 'Renamed');
      assert.equal((await api('POST', `/assets/${created.id}/restore`)).status, 200);
      assert.equal((await api('GET', '/assets/' + created.id)).status, 200);
    });

    test('writes the asset timeline', async () => {
      const { rows } = await pool.query(
        'SELECT event_type, details FROM asset_events WHERE asset_id = $1 ORDER BY occurred_at, id',
        [created.id],
      );
      assert.deepEqual(
        rows.map((r) => r.event_type),
        ['created', 'updated', 'archived', 'restored'],
      );
      assert.ok(rows[1].details.changed.includes('status'));
    });

    test('unknown or malformed ids are 404', async () => {
      assert.equal((await api('GET', '/assets/not-a-uuid')).status, 404);
      assert.equal((await api('GET', '/assets/00000000-0000-4000-8000-000000000000')).status, 404);
      assert.equal((await api('POST', '/assets/00000000-0000-4000-8000-000000000000/restore')).status, 404);
    });

    test('malformed JSON is a JSON 400', async () => {
      const res = await api('POST', '/assets', '{bad');
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INVALID_JSON');
    });
  });

  describe('S-02 list: filter, search, sort, page', () => {
    before(async () => {
      const fixtures = [
        asset('S02-A1', { name: 'Alpha laptop', type: 'LAPTOP', status: 'AVAILABLE', location: 'HQ', purchaseDate: '2021-01-01' }),
        asset('S02-A2', { name: 'Beta laptop', type: 'LAPTOP', status: 'ON_LOAN', location: 'OFFICE', purchaseDate: '2022-01-01' }),
        asset('S02-M1', { name: 'Gamma monitor', type: 'MONITOR', status: 'AVAILABLE', location: 'HQ', purchaseDate: '2023-01-01' }),
        asset('S02-P1', { name: '100%_printer', type: 'PRINTER', status: 'RETIRED', location: 'WAREHOUSE', purchaseDate: '2019-01-01' }),
        asset('S02-P2', { name: 'Delta printer', type: 'PRINTER', status: 'AVAILABLE', location: 'HQ', purchaseDate: '2024-01-01' }),
      ];
      for (const body of fixtures) assert.equal((await api('POST', '/assets', body)).status, 201);
    });

    test('pages with a total count', async () => {
      const p1 = await api('GET', '/assets?search=S02-&pageSize=2&page=1');
      const p3 = await api('GET', '/assets?search=S02-&pageSize=2&page=3');
      assert.equal(p1.status, 200);
      assert.equal(p1.body.total, 5);
      assert.equal(p1.body.items.length, 2);
      assert.deepEqual([p1.body.page, p1.body.pageSize], [1, 2]);
      assert.equal(p3.body.items.length, 1);
    });

    test('filters by type, status and location together', async () => {
      const res = await api('GET', '/assets?search=S02-&type=laptop&status=AVAILABLE&location=HQ');
      assert.deepEqual(res.body.items.map((a) => a.tag), ['S02-A1']);
    });

    test('values of one field OR together; exclusions all apply', async () => {
      const either = await api('GET', '/assets?search=S02-&type=LAPTOP&type=monitor');
      assert.deepEqual(either.body.items.map((a) => a.tag), ['S02-A1', 'S02-A2', 'S02-M1']);
      const excluded = await api('GET', '/assets?search=S02-&typeNot=LAPTOP&statusNot=RETIRED');
      assert.deepEqual(excluded.body.items.map((a) => a.tag), ['S02-M1', 'S02-P2']);
    });

    test('searches tag and name, treating % and _ literally', async () => {
      assert.deepEqual((await api('GET', '/assets?search=gamma')).body.items.map((a) => a.tag), ['S02-M1']);
      assert.deepEqual((await api('GET', '/assets?search=%25')).body.items.map((a) => a.tag), ['S02-P1']);
    });

    test('sorts by any column in either direction', async () => {
      const res = await api('GET', '/assets?search=S02-&sort=purchaseDate&direction=desc');
      assert.deepEqual(res.body.items.map((a) => a.tag), ['S02-P2', 'S02-M1', 'S02-A2', 'S02-A1', 'S02-P1']);
    });

    test('rejects bad paging parameters', async () => {
      const res = await api('GET', '/assets?pageSize=100000&sort=password');
      assert.equal(res.status, 422);
      assert.ok(res.body.error.fields.pageSize);
      assert.ok(res.body.error.fields.sort);
    });
  });

  describe('S-03 / S-04 export', () => {
    test('exports every filtered row across pages, in list order, with dates as dates', async () => {
      const { sheet, rowCount } = await exportSheet({
        filters: { search: 'S02-', type: ['PRINTER'], locationNot: 'OFFICE' },
        sort: { key: 'purchaseDate', direction: 'asc' },
      });
      assert.equal(rowCount, 2);
      assert.deepEqual(sheet.getRow(1).values.slice(1), ['Tag', 'Name', 'Type', 'Status', 'Location', 'Purchase Date']);
      assert.equal(sheet.getCell('A2').value, 'S02-P1');
      assert.equal(sheet.getCell('A3').value, 'S02-P2');
      assert.ok(sheet.getCell('F2').value instanceof Date);
      assert.equal(sheet.getCell('F2').numFmt, 'dd/mm/yyyy');
    });

    test('applies column choice, order, labels and date format', async () => {
      const { sheet } = await exportSheet({
        filters: { search: 'S02-A1' },
        columns: [
          { key: 'purchaseDate', label: 'Bought', included: true },
          { key: 'tag', label: 'Asset #', included: true },
          { key: 'name', label: 'Name', included: false },
        ],
        dateFormat: 'YYYY-MM-DD',
      });
      assert.deepEqual(sheet.getRow(1).values.slice(1), ['Bought', 'Asset #']);
      assert.equal(sheet.getCell('B2').value, 'S02-A1');
      assert.equal(sheet.getCell('A2').numFmt, 'yyyy-mm-dd');
    });

    test('never exports deleted assets', async () => {
      const list = await api('GET', '/assets?search=S02-A2');
      await api('DELETE', '/assets/' + list.body.items[0].id);
      const { rowCount } = await exportSheet({ filters: { search: 'S02-A' } });
      assert.equal(rowCount, 1);
    });

    test('rejects invalid export parameters', async () => {
      const res = await api('POST', '/exports/assets', { columns: [{ key: 'serial', label: 'x' }], dateFormat: 'x' });
      assert.equal(res.status, 422);
      assert.ok(res.body.error.fields['columns[0].key']);
      assert.ok(res.body.error.fields.dateFormat);
    });
  });

  describe('S-04 export profiles', () => {
    const input = {
      name: 'Monthly report',
      dateFormat: 'MM/DD/YYYY',
      columns: [
        { key: 'name', label: 'Asset name', included: true },
        { key: 'tag', label: 'Tag', included: true },
        { key: 'type', label: 'Type', included: false },
      ],
    };
    let profile;

    test('creates a named profile', async () => {
      const res = await api('POST', '/export-profiles', input);
      assert.equal(res.status, 201);
      profile = res.body;
      assert.equal(profile.name, 'Monthly report');
      assert.equal(profile.dateFormat, 'MM/DD/YYYY');
      assert.deepEqual(
        profile.columns.map((c) => [c.key, c.label, c.included]),
        [
          ['name', 'Asset name', true],
          ['tag', 'Tag', true],
          ['type', 'Type', false],
          ['status', 'Status', false],
          ['location', 'Location', false],
          ['purchaseDate', 'Purchase Date', false],
        ],
      );
    });

    test('lists and reads the saved profile', async () => {
      const list = await api('GET', '/export-profiles');
      assert.deepEqual(list.body.map((p) => p.id), [profile.id]);
      assert.equal((await api('GET', '/export-profiles/' + profile.id)).body.name, 'Monthly report');
    });

    test('rejects a duplicate name, case-insensitively', async () => {
      const res = await api('POST', '/export-profiles', { ...input, name: 'MONTHLY REPORT' });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'DUPLICATE_NAME');
    });

    test('edits name, format and columns', async () => {
      const res = await api('PUT', '/export-profiles/' + profile.id, {
        name: 'Quarterly',
        dateFormat: 'YYYY-MM-DD',
        columns: [{ key: 'purchaseDate', label: 'Bought', included: true }],
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.name, 'Quarterly');
      assert.deepEqual(res.body.columns[0], { key: 'purchaseDate', label: 'Bought', included: true });
      assert.equal(res.body.columns.filter((c) => c.included).length, 1);
    });

    test('rejects a profile with no included column', async () => {
      const res = await api('PUT', '/export-profiles/' + profile.id, {
        ...input,
        columns: [{ key: 'tag', label: 'Tag', included: false }],
      });
      assert.equal(res.status, 422);
    });

    test('deletes the profile, freeing its name', async () => {
      assert.equal((await api('DELETE', '/export-profiles/' + profile.id)).status, 204);
      assert.equal((await api('GET', '/export-profiles/' + profile.id)).status, 404);
      assert.equal((await api('DELETE', '/export-profiles/' + profile.id)).status, 404);
      assert.equal((await api('POST', '/export-profiles', { ...input, name: 'Quarterly' })).status, 201);
    });
  });

  describe('US17 asset types', () => {
    test('rejects a duplicate code under fields.code', async () => {
      const res = await api('POST', '/asset-types', { code: 'LAPTOP', name: 'anything' });
      assert.equal(res.status, 409);
      assert.match(res.body.error.fields.code, /LAPTOP/);
    });

    test('creates a type that then appears in reference data', async () => {
      const res = await api('POST', '/asset-types', { code: 'TABLET', name: 'Máy tính bảng' });
      assert.equal(res.status, 201);
      assert.deepEqual(res.body, { code: 'TABLET', name: 'Máy tính bảng' });

      const ref = await api('GET', '/reference-data');
      assert.deepEqual(ref.body.types.find((t) => t.code === 'TABLET'), res.body);
    });

    test('trims both fields and upper-cases the code', async () => {
      const res = await api('POST', '/asset-types', { code: '  docking_station ', name: ' Dock ' });
      assert.equal(res.status, 201);
      assert.deepEqual(res.body, { code: 'DOCKING_STATION', name: 'Dock' });
    });

    test('rejects a code with characters outside A-Z 0-9 _ -', async () => {
      const res = await api('POST', '/asset-types', { code: 'BAD CODE!', name: 'Bad' });
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'VALIDATION_FAILED');
      assert.ok(res.body.error.fields.code);
    });

    test('rejects a duplicate name case-insensitively under fields.name', async () => {
      assert.equal((await api('POST', '/asset-types', { code: 'PROJECTOR', name: 'Projector' })).status, 201);

      for (const name of ['projector', 'PROJECTOR', '  Projector  ']) {
        const res = await api('POST', '/asset-types', { code: 'PROJECTOR_2', name });
        assert.equal(res.status, 409, name);
        assert.equal(res.body.error.code, 'DUPLICATE_NAME');
        assert.match(res.body.error.fields.name, /already exists/);
        assert.equal(res.body.error.fields.code, undefined);
      }
    });

    test('rejects a seeded Vietnamese name in a different case', async () => {
      const res = await api('POST', '/asset-types', { code: 'DESKTOP_2', name: 'MÁY TÍNH ĐỂ BÀN' });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'DUPLICATE_NAME');
      assert.ok(res.body.error.fields.name);
    });

    test('rejects a missing, empty or whitespace-only name', async () => {
      for (const name of [undefined, '', '   ', '\t\n ']) {
        const res = await api('POST', '/asset-types', { code: 'BLANK', name });
        assert.equal(res.status, 422, JSON.stringify(name));
        assert.equal(res.body.error.fields.name, 'Required');
      }
    });

    test('rejects a code over 32 and a name over 255 characters', async () => {
      const res = await api('POST', '/asset-types', { code: 'A'.repeat(33), name: 'n'.repeat(256) });
      assert.equal(res.status, 422);
      assert.match(res.body.error.fields.code, /32/);
      assert.match(res.body.error.fields.name, /255/);
    });
  });

  describe('US18-T3 create a custom attribute', () => {
    const attribute = { key: 'screen_size', label: 'Screen size', dataType: 'number', isRequired: true };

    before(async () => {
      for (const code of ['ATTR_A', 'ATTR_B']) {
        assert.equal((await api('POST', '/asset-types', { code, name: 'Attribute test ' + code })).status, 201);
      }
    });

    test('creates an attribute on a type', async () => {
      const res = await api('POST', '/asset-types/ATTR_A/attributes', attribute);
      assert.equal(res.status, 201);
      assert.deepEqual(res.body, { ...attribute, isActive: true });
    });

    test('trims key and label, and defaults isRequired to false', async () => {
      const res = await api('POST', '/asset-types/attr_a/attributes', { key: ' serial_no ', label: ' Serial ', dataType: 'text' });
      assert.equal(res.status, 201);
      assert.deepEqual(res.body, { key: 'serial_no', label: 'Serial', dataType: 'text', isRequired: false, isActive: true });
    });

    test('rejects the same key twice on one type under fields.key', async () => {
      const res = await api('POST', '/asset-types/ATTR_A/attributes', { ...attribute, label: 'Other' });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'DUPLICATE_KEY');
      assert.match(res.body.error.fields.key, /hidden/);
    });

    test('allows the same key on two different types', async () => {
      const res = await api('POST', '/asset-types/ATTR_B/attributes', attribute);
      assert.equal(res.status, 201);
    });

    test('rejects a key that matches an inactive attribute', async () => {
      assert.equal((await api('POST', '/asset-types/ATTR_A/attributes', { key: 'warranty', label: 'Warranty', dataType: 'date' })).status, 201);
      await pool.query(
        `UPDATE asset_type_attributes SET is_active = false
         WHERE key = 'warranty' AND asset_type_id = (SELECT id FROM asset_types WHERE code = 'ATTR_A')`,
      );

      const res = await api('POST', '/asset-types/ATTR_A/attributes', { key: 'warranty', label: 'Warranty', dataType: 'date' });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'DUPLICATE_KEY');
      assert.match(res.body.error.fields.key, /hidden/);
    });

    test('rejects a key outside ^[a-z][a-z0-9_]*$ or over 32 characters', async () => {
      for (const key of ['Screen_size', '1st_owner', 'screen size', 'a'.repeat(33)]) {
        const res = await api('POST', '/asset-types/ATTR_A/attributes', { ...attribute, key });
        assert.equal(res.status, 422, key);
        assert.equal(res.body.error.code, 'VALIDATION_FAILED');
        assert.ok(res.body.error.fields.key, key);
      }
    });

    test('rejects a blank label and an unknown data type', async () => {
      const res = await api('POST', '/asset-types/ATTR_A/attributes', { key: 'colour', label: '   ', dataType: 'color' });
      assert.equal(res.status, 422);
      assert.equal(res.body.error.fields.label, 'Required');
      assert.ok(res.body.error.fields.dataType);
    });

    test('404s for an unknown or inactive type code', async () => {
      assert.equal((await api('POST', '/asset-types', { code: 'ATTR_RETIRED', name: 'Attribute test retired' })).status, 201);
      await pool.query(`UPDATE asset_types SET is_active = false WHERE code = 'ATTR_RETIRED'`);

      for (const code of ['NO_SUCH_TYPE', 'ATTR_RETIRED']) {
        const res = await api('POST', `/asset-types/${code}/attributes`, attribute);
        assert.equal(res.status, 404, code);
        assert.equal(res.body.error.code, 'NOT_FOUND');
      }
    });
  });

  describe('US17-T5 read a type with its attribute config', () => {
    const zeta = { key: 'zeta', label: 'Zeta', dataType: 'text', isRequired: false, isActive: true };
    const hidden = { key: 'hidden_one', label: 'Hidden', dataType: 'boolean', isRequired: false, isActive: false };
    const alpha = { key: 'alpha', label: 'Alpha', dataType: 'number', isRequired: true, isActive: true };

    before(async () => {
      for (const code of ['READ_A', 'READ_EMPTY', 'READ_RETIRED']) {
        assert.equal((await api('POST', '/asset-types', { code, name: 'Read test ' + code })).status, 201);
      }
      // Created out of key order, so the response order can only come from created_at.
      for (const { isActive, ...input } of [zeta, hidden, alpha]) {
        assert.equal((await api('POST', '/asset-types/READ_A/attributes', input)).status, 201);
      }
      await pool.query(
        `UPDATE asset_type_attributes SET is_active = false
         WHERE key = 'hidden_one' AND asset_type_id = (SELECT id FROM asset_types WHERE code = 'READ_A')`,
      );
      await pool.query(`UPDATE asset_types SET is_active = false WHERE code = 'READ_RETIRED'`);
    });

    test('returns the type with its active attributes in creation order', async () => {
      const res = await api('GET', '/asset-types/read_a');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { code: 'READ_A', name: 'Read test READ_A', attributes: [zeta, alpha] });
    });

    test('includeInactive=true also returns hidden attributes; false is the default', async () => {
      const all = await api('GET', '/asset-types/READ_A?includeInactive=true');
      assert.equal(all.status, 200);
      assert.deepEqual(all.body.attributes, [zeta, hidden, alpha]);

      const active = await api('GET', '/asset-types/READ_A?includeInactive=false');
      assert.deepEqual(active.body.attributes, [zeta, alpha]);
    });

    test('returns an empty list for a type with no attributes', async () => {
      const res = await api('GET', '/asset-types/READ_EMPTY');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { code: 'READ_EMPTY', name: 'Read test READ_EMPTY', attributes: [] });
    });

    test('rejects includeInactive other than true or false', async () => {
      for (const value of ['yes', '1', 'TRUE']) {
        const res = await api('GET', '/asset-types/READ_A?includeInactive=' + value);
        assert.equal(res.status, 422, value);
        assert.equal(res.body.error.code, 'VALIDATION_FAILED');
        assert.ok(res.body.error.fields.includeInactive, value);
      }
    });

    test('404s for an unknown or inactive type code', async () => {
      for (const code of ['NO_SUCH_TYPE', 'READ_RETIRED']) {
        const res = await api('GET', '/asset-types/' + code);
        assert.equal(res.status, 404, code);
        assert.equal(res.body.error.code, 'NOT_FOUND');
      }
    });

    test('GET /:code/attributes returns the same list', async () => {
      assert.deepEqual((await api('GET', '/asset-types/READ_A/attributes')).body, [zeta, alpha]);
      assert.deepEqual((await api('GET', '/asset-types/READ_A/attributes?includeInactive=true')).body, [zeta, hidden, alpha]);
      assert.equal((await api('GET', '/asset-types/READ_A/attributes?includeInactive=yes')).status, 422);
      assert.equal((await api('GET', '/asset-types/NO_SUCH_TYPE/attributes')).status, 404);
    });
  });

  describe('US17-T6 assets can use a specialized asset type', () => {
    let created;

    // These assets are saved without custom attribute values (US18-T6).
    function assertNoExtendedAttributes(body) {
      assert.deepEqual(body.extendedAttributes, {});
      assert.equal('extended_attributes' in body, false);
    }

    // A type is specialized once it has custom attributes (US17-T1). The attribute is
    // optional, so saving an asset without a value stays valid once US18-T5 enforces
    // required ones.
    before(async () => {
      const attribute = { key: 'serial_no', label: 'Serial number', dataType: 'text' };
      for (const [code, name] of [['T6_ALPHA', 'T6 Alpha type'], ['T6_BETA', 'T6 Beta type']]) {
        assert.equal((await api('POST', '/asset-types', { code, name })).status, 201);
        assert.equal((await api('POST', `/asset-types/${code}/attributes`, attribute)).status, 201);
      }
    });

    test('creates an asset with a type made through POST /asset-types', async () => {
      const res = await api('POST', '/assets', asset('T6-001', { type: 'T6_ALPHA' }));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      created = res.body;
      assert.deepEqual([created.type, created.typeName], ['T6_ALPHA', 'T6 Alpha type']);
      assertNoExtendedAttributes(created);

      const read = await api('GET', '/assets/' + created.id);
      assert.equal(read.status, 200);
      assert.deepEqual([read.body.type, read.body.typeName], ['T6_ALPHA', 'T6 Alpha type']);
      assertNoExtendedAttributes(read.body);
    });

    test('switches the asset to another new type', async () => {
      const res = await api('PUT', '/assets/' + created.id, asset('T6-001', { type: 'T6_BETA' }));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual([res.body.type, res.body.typeName], ['T6_BETA', 'T6 Beta type']);
      assertNoExtendedAttributes(res.body);
    });

    test('filters the list by the new type, and excludes it with typeNot', async () => {
      assert.equal((await api('POST', '/assets', asset('T6-002', { type: 'T6_ALPHA' }))).status, 201);

      const only = await api('GET', '/assets?type=T6_BETA');
      assert.deepEqual(only.body.items.map((a) => a.tag), ['T6-001']);
      only.body.items.forEach(assertNoExtendedAttributes);

      const excluded = await api('GET', '/assets?search=T6-&typeNot=T6_BETA');
      assert.deepEqual(excluded.body.items.map((a) => a.tag), ['T6-002']);
    });

    test("exports show the new type's name", async () => {
      const { sheet, rowCount } = await exportSheet({ filters: { search: 'T6-' } });
      assert.equal(rowCount, 2);
      assert.equal(sheet.getCell('C1').value, 'Type');
      assert.deepEqual(
        [sheet.getCell('A2').value, sheet.getCell('C2').value, sheet.getCell('A3').value, sheet.getCell('C3').value],
        ['T6-001', 'T6 Beta type', 'T6-002', 'T6 Alpha type'],
      );
    });
  });

  // US17-T7 fills the acceptance-criteria gap. The rest is covered elsewhere:
  // AC1 "creates a type that then appears in reference data" and US17-T6 "creates
  // an asset with a type made through POST /asset-types"; AC3 "rejects a duplicate
  // name case-insensitively under fields.name"; AC4 US18-T3 "creates an attribute
  // on a type" and US17-T5 "returns the type with its active attributes in creation
  // order"; AC5 US17-T6 "filters the list by the new type, and excludes it with
  // typeNot" and "exports show the new type's name".
  describe('US17-T7 a new type keeps every common field (AC2)', () => {
    const input = {
      tag: 'T7-001',
      name: 'Every common field',
      type: 'T7_GAMMA',
      status: 'RETIRED',
      location: 'WAREHOUSE',
      purchaseDate: '2023-07-31',
      notes: 'Bought for the T7 test',
    };

    before(async () => {
      assert.equal((await api('POST', '/asset-types', { code: 'T7_GAMMA', name: 'T7 Gamma type' })).status, 201);
      const attribute = { key: 'serial_no', label: 'Serial number', dataType: 'text' };
      assert.equal((await api('POST', '/asset-types/T7_GAMMA/attributes', attribute)).status, 201);
    });

    test('an asset of the new type stores and returns every common field', async () => {
      const created = await api('POST', '/assets', input);
      assert.equal(created.status, 201, JSON.stringify(created.body));

      const read = await api('GET', '/assets/' + created.body.id);
      const listed = await api('GET', '/assets?type=T7_GAMMA');
      assert.equal(listed.body.total, 1);

      for (const body of [created.body, read.body, listed.body.items[0]]) {
        assert.deepEqual(
          { tag: body.tag, name: body.name, type: body.type, status: body.status, location: body.location, purchaseDate: body.purchaseDate, notes: body.notes },
          input,
        );
        assert.equal(body.typeName, 'T7 Gamma type');
        assert.ok(body.statusName);
        assert.ok(body.locationName);
      }
    });
  });

  describe('US18-T4 edit, hide and restore a custom attribute', () => {
    const base = '/asset-types/EDIT_A/attributes';

    async function attributeRow(key) {
      const { rows } = await pool.query(
        `SELECT a.label, a.data_type, a.is_required, a.is_active, a.updated_at
         FROM asset_type_attributes a JOIN asset_types t ON t.id = a.asset_type_id
         WHERE t.code = 'EDIT_A' AND a.key = $1`,
        [key],
      );
      return rows[0];
    }

    async function extendedAttributes(tag) {
      const { rows } = await pool.query('SELECT extended_attributes::text AS value FROM assets WHERE asset_tag = $1', [tag]);
      return rows[0].value;
    }

    // ram_gb has values on two EDIT_A assets, one of them soft-deleted, and on a
    // LAPTOP, which must not count: the lock is per type. gpu has a value on one.
    before(async () => {
      assert.equal((await api('POST', '/asset-types', { code: 'EDIT_A', name: 'Edit test type' })).status, 201);
      for (const [key, dataType] of [['cpu', 'text'], ['ram_gb', 'number'], ['colour', 'text'], ['gpu', 'text']]) {
        assert.equal((await api('POST', base, { key, label: key, dataType })).status, 201);
      }
      for (const [tag, type] of [['EDIT-001', 'EDIT_A'], ['EDIT-002', 'EDIT_A'], ['EDIT-003', 'LAPTOP']]) {
        assert.equal((await api('POST', '/assets', asset(tag, { type }))).status, 201);
      }
      await pool.query(`UPDATE assets SET extended_attributes = '{"ram_gb": 16, "cpu": "i7"}' WHERE asset_tag IN ('EDIT-001', 'EDIT-002')`);
      await pool.query(`UPDATE assets SET extended_attributes = extended_attributes || '{"gpu": "rtx"}' WHERE asset_tag = 'EDIT-001'`);
      await pool.query(`UPDATE assets SET extended_attributes = '{"ram_gb": 8}' WHERE asset_tag = 'EDIT-003'`);
      const deleted = await api('GET', '/assets?search=EDIT-002');
      assert.equal((await api('DELETE', '/assets/' + deleted.body.items[0].id)).status, 204);
    });

    test('edits the label and moves updated_at', async () => {
      const before = await attributeRow('cpu');
      const res = await api('PUT', base + '/cpu', { label: 'Processor', dataType: 'text', isRequired: false });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body, { key: 'cpu', label: 'Processor', dataType: 'text', isRequired: false, isActive: true });
      assert.ok((await attributeRow('cpu')).updated_at > before.updated_at);
    });

    test('toggles isRequired both ways', async () => {
      for (const isRequired of [true, false]) {
        const res = await api('PUT', base + '/cpu', { label: 'Processor', dataType: 'text', isRequired });
        assert.equal(res.status, 200);
        assert.equal(res.body.isRequired, isRequired);
        assert.equal((await attributeRow('cpu')).is_required, isRequired);
      }
    });

    test('changes the data type while no asset holds a value', async () => {
      const res = await api('PUT', base + '/colour', { label: 'Colour', dataType: 'boolean', isRequired: false });
      assert.equal(res.status, 200);
      assert.equal(res.body.dataType, 'boolean');
    });

    test('refuses a data type change once assets of the type hold values, deleted ones included', async () => {
      const res = await api('PUT', base + '/ram_gb', { label: 'RAM', dataType: 'text', isRequired: false });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'DATA_TYPE_LOCKED');
      assert.match(res.body.error.fields.dataType, /\b2 assets of this type, deleted ones included, already hold a value\b/);
      assert.equal((await attributeRow('ram_gb')).data_type, 'number');

      const one = await api('PUT', base + '/gpu', { label: 'GPU', dataType: 'number', isRequired: false });
      assert.equal(one.status, 409);
      assert.match(one.body.error.fields.dataType, /\b1 asset of this type, deleted ones included, already holds a value\b/);

      const same = await api('PUT', base + '/ram_gb', { label: 'RAM', dataType: 'number', isRequired: false });
      assert.equal(same.status, 200);
      assert.equal(same.body.label, 'RAM');
    });

    test('rejects a body key that differs from the path; the same key is accepted', async () => {
      const res = await api('PUT', base + '/cpu', { key: 'processor', label: 'Processor', dataType: 'text', isRequired: false });
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'VALIDATION_FAILED');
      assert.match(res.body.error.fields.key, /cannot be changed/);

      const same = await api('PUT', base + '/cpu', { key: 'cpu', label: 'Processor', dataType: 'text', isRequired: false });
      assert.equal(same.status, 200);
    });

    test('rejects a body missing any field: PUT replaces the whole definition', async () => {
      const res = await api('PUT', base + '/cpu', { label: '  ' });
      assert.equal(res.status, 422);
      assert.deepEqual(Object.keys(res.body.error.fields).sort(), ['dataType', 'isRequired', 'label']);
    });

    test('hides an attribute without touching asset values; hiding again is harmless', async () => {
      const valuesBefore = await extendedAttributes('EDIT-001');
      for (let i = 0; i < 2; i += 1) {
        assert.equal((await api('DELETE', base + '/ram_gb')).status, 204);
      }
      assert.equal((await attributeRow('ram_gb')).is_active, false);

      const visible = await api('GET', '/asset-types/EDIT_A');
      assert.equal(visible.body.attributes.some((a) => a.key === 'ram_gb'), false);
      const all = await api('GET', '/asset-types/EDIT_A?includeInactive=true');
      assert.equal(all.body.attributes.find((a) => a.key === 'ram_gb').isActive, false);

      assert.equal(await extendedAttributes('EDIT-001'), valuesBefore);
    });

    test('edits a hidden attribute', async () => {
      const res = await api('PUT', base + '/ram_gb', { label: 'Memory (GB)', dataType: 'number', isRequired: true });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { key: 'ram_gb', label: 'Memory (GB)', dataType: 'number', isRequired: true, isActive: false });
    });

    test('a hidden key still cannot be created again', async () => {
      const res = await api('POST', base, { key: 'ram_gb', label: 'RAM', dataType: 'number' });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'DUPLICATE_KEY');
    });

    test('restores a hidden attribute with its values intact; restoring again is harmless', async () => {
      const valuesBefore = await extendedAttributes('EDIT-001');
      const res = await api('POST', base + '/ram_gb/restore');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { key: 'ram_gb', label: 'Memory (GB)', dataType: 'number', isRequired: true, isActive: true });

      const visible = await api('GET', '/asset-types/EDIT_A');
      assert.ok(visible.body.attributes.some((a) => a.key === 'ram_gb'));
      assert.equal(await extendedAttributes('EDIT-001'), valuesBefore);
      assert.match(valuesBefore, /"ram_gb": 16/);

      assert.equal((await api('POST', base + '/ram_gb/restore')).status, 200);
    });

    test('404s for an unknown type or key', async () => {
      const body = { label: 'x', dataType: 'text', isRequired: false };
      for (const path of ['/asset-types/NO_SUCH_TYPE/attributes/cpu', base + '/no_such_key']) {
        for (const [method, suffix, payload] of [['PUT', '', body], ['DELETE', ''], ['POST', '/restore']]) {
          const res = await api(method, path + suffix, payload);
          assert.equal(res.status, 404, `${method} ${path}${suffix}`);
          assert.equal(res.body.error.code, 'NOT_FOUND');
        }
      }
    });
  });

  // Setting and toggling the flag is covered by US18-T3 ("creates an attribute on
  // a type", "defaults isRequired to false") and US18-T4 ("toggles isRequired both
  // ways"). Enforcement on asset save is US18-T6.
  describe('US18-T5 required or optional attribute', () => {
    const base = '/asset-types/REQ_A/attributes';

    async function allExtendedAttributes() {
      const { rows } = await pool.query('SELECT id, extended_attributes::text AS value FROM assets ORDER BY id');
      return rows;
    }

    // One asset holds a value for the key, one does not: making the attribute
    // required must not backfill, strip or rewrite either.
    before(async () => {
      assert.equal((await api('POST', '/asset-types', { code: 'REQ_A', name: 'Required test type' })).status, 201);
      assert.equal((await api('POST', base, { key: 'owner', label: 'Owner', dataType: 'text' })).status, 201);
      for (const tag of ['REQ-001', 'REQ-002']) {
        assert.equal((await api('POST', '/assets', asset(tag, { type: 'REQ_A' }))).status, 201);
      }
      await pool.query(`UPDATE assets SET extended_attributes = '{"owner": "IT", "note": "x"}' WHERE asset_tag = 'REQ-001'`);
    });

    test("toggling isRequired leaves every asset's extended_attributes byte-identical", async () => {
      const before = await allExtendedAttributes();
      assert.ok(before.some((a) => a.value.includes('"owner"')));

      for (const isRequired of [true, false, true]) {
        const res = await api('PUT', base + '/owner', { label: 'Owner', dataType: 'text', isRequired });
        assert.equal(res.status, 200);
        assert.equal(res.body.isRequired, isRequired);
        assert.deepEqual(await allExtendedAttributes(), before);
      }
    });
  });

  describe('US18-T6 custom attribute values on assets', () => {
    const base = '/asset-types/VAL_A/attributes';
    const valid = { serial: 'SN-1', ram_gb: 16.5, warranty_end: '2027-02-28', docked: false };

    function valAsset(tag, extendedAttributes, overrides = {}) {
      return asset(tag, { type: 'VAL_A', extendedAttributes, ...overrides });
    }

    async function createValAsset(tag, extendedAttributes = valid) {
      const res = await api('POST', '/assets', valAsset(tag, extendedAttributes));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      return res.body.id;
    }

    async function lastUpdate(id) {
      const { rows } = await pool.query(
        `SELECT details FROM asset_events WHERE asset_id = $1 AND event_type = 'updated'
          ORDER BY occurred_at DESC, id DESC LIMIT 1`,
        [id],
      );
      return rows[0].details;
    }

    // VAL_A has one attribute per data type; serial is required. VAL_B reuses two of
    // its keys with other definitions, docked hidden, for the type-change rule.
    before(async () => {
      assert.equal((await api('POST', '/asset-types', { code: 'VAL_A', name: 'Value test type A' })).status, 201);
      for (const [key, dataType, isRequired] of [
        ['serial', 'text', true],
        ['ram_gb', 'number', false],
        ['warranty_end', 'date', false],
        ['docked', 'boolean', false],
      ]) {
        assert.equal((await api('POST', base, { key, label: key, dataType, isRequired })).status, 201);
      }
      assert.equal((await api('POST', '/asset-types', { code: 'VAL_B', name: 'Value test type B' })).status, 201);
      for (const key of ['ram_gb', 'docked']) {
        assert.equal((await api('POST', '/asset-types/VAL_B/attributes', { key, label: key, dataType: 'text' })).status, 201);
      }
      assert.equal((await api('DELETE', '/asset-types/VAL_B/attributes/docked')).status, 204);
    });

    test('saves one valid value per data type and reads it back', async () => {
      const created = await api('POST', '/assets', valAsset('VAL-001', { ...valid, serial: '  SN-1  ' }));
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.deepEqual(created.body.extendedAttributes, valid);

      const read = await api('GET', '/assets/' + created.body.id);
      assert.deepEqual(read.body.extendedAttributes, valid);
      const listed = await api('GET', '/assets?search=VAL-001');
      assert.deepEqual(listed.body.items[0].extendedAttributes, valid);
    });

    test('leaves blank or null optional values unset', async () => {
      const res = await api('POST', '/assets', valAsset('VAL-002', { serial: 'SN-2', ram_gb: null, warranty_end: '' }));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.deepEqual(res.body.extendedAttributes, { serial: 'SN-2' });
    });

    const badValues = [
      ['serial', 42, 'Must be a string'],
      ['serial', 'x'.repeat(2001), 'Must be at most 2000 characters'],
      ['ram_gb', '16', 'Must be a number'],
      ['ram_gb', true, 'Must be a number'],
      ['warranty_end', '2027-02-30', 'Not a real calendar date'],
      ['warranty_end', '28/02/2027', 'Must be a date as YYYY-MM-DD'],
      ['warranty_end', 20270228, 'Must be a string'],
      ['docked', 'true', 'Must be true or false'],
      ['docked', 0, 'Must be true or false'],
    ];
    for (const [key, value, message] of badValues) {
      test(`rejects ${key} = ${JSON.stringify(value).slice(0, 16)} on extendedAttributes.${key}`, async () => {
        const res = await api('POST', '/assets', valAsset('VAL-BAD', { ...valid, [key]: value }));
        assert.equal(res.status, 422);
        assert.equal(res.body.error.code, 'VALIDATION_FAILED');
        assert.deepEqual(res.body.error.fields, { ['extendedAttributes.' + key]: message });
      });
    }

    test('rejects a bad value on update too, keeping the stored values', async () => {
      const id = await createValAsset('VAL-003');
      const res = await api('PUT', '/assets/' + id, valAsset('VAL-003', { ...valid, ram_gb: '32' }));
      assert.equal(res.status, 422);
      assert.deepEqual(res.body.error.fields, { 'extendedAttributes.ram_gb': 'Must be a number' });
      assert.deepEqual((await api('GET', '/assets/' + id)).body.extendedAttributes, valid);
    });

    test('rejects a key the type does not define, and a non-object', async () => {
      const unknown = await api('POST', '/assets', valAsset('VAL-BAD', { ...valid, colour: 'red' }));
      assert.equal(unknown.status, 422);
      assert.deepEqual(unknown.body.error.fields, { 'extendedAttributes.colour': 'Unknown field' });

      const notObject = await api('POST', '/assets', valAsset('VAL-BAD', ['SN-1']));
      assert.equal(notObject.status, 422);
      assert.deepEqual(notObject.body.error.fields, { extendedAttributes: 'Must be an object' });
    });

    test('requires a required attribute on create', async () => {
      for (const extendedAttributes of [undefined, {}, { serial: '   ' }, { serial: null }]) {
        const res = await api('POST', '/assets', valAsset('VAL-BAD', extendedAttributes));
        assert.equal(res.status, 422, JSON.stringify(extendedAttributes));
        assert.deepEqual(res.body.error.fields, { 'extendedAttributes.serial': 'Required' });
      }
    });

    test('requires a required attribute on every update', async () => {
      const id = await createValAsset('VAL-004');
      const { serial, ...rest } = valid;
      const res = await api('PUT', '/assets/' + id, valAsset('VAL-004', rest, { name: 'Renamed' }));
      assert.equal(res.status, 422);
      assert.deepEqual(res.body.error.fields, { 'extendedAttributes.serial': 'Required' });
      assert.equal((await api('GET', '/assets/' + id)).body.name, 'Asset VAL-004');
    });

    test('PUT keeps a hidden value: set ram_gb, hide it, rename the asset, restore ram_gb', async () => {
      const id = await createValAsset('VAL-005');
      assert.equal((await api('DELETE', base + '/ram_gb')).status, 204);

      const { ram_gb, ...visible } = valid;
      const res = await api('PUT', '/assets/' + id, valAsset('VAL-005', visible, { name: 'Renamed' }));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual((await lastUpdate(id)).changed, ['name']);

      assert.equal((await api('POST', base + '/ram_gb/restore')).status, 200);
      const read = await api('GET', '/assets/' + id);
      assert.equal(read.body.name, 'Renamed');
      assert.deepEqual(read.body.extendedAttributes, valid);
    });

    test('ignores a hidden key sent by the client and keeps the stored value', async () => {
      const id = await createValAsset('VAL-006');
      assert.equal((await api('DELETE', base + '/ram_gb')).status, 204);

      for (const ramGb of [99, 'not even a number']) {
        const res = await api('PUT', '/assets/' + id, valAsset('VAL-006', { ...valid, ram_gb: ramGb }));
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.extendedAttributes.ram_gb, valid.ram_gb);
      }
      const created = await api('POST', '/assets', valAsset('VAL-007', { ...valid, ram_gb: 99 }));
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal('ram_gb' in created.body.extendedAttributes, false);

      assert.equal((await api('POST', base + '/ram_gb/restore')).status, 200);
    });

    test('a type change validates against the new type and records the dropped values', async () => {
      const id = await createValAsset('VAL-008');

      const bad = await api('PUT', '/assets/' + id, valAsset('VAL-008', { serial: 'SN-1' }, { type: 'VAL_B' }));
      assert.equal(bad.status, 422);
      assert.deepEqual(bad.body.error.fields, { 'extendedAttributes.serial': 'Unknown field' });

      // docked is hidden on VAL_B, yet the old value is not carried over: keys are per type.
      const res = await api('PUT', '/assets/' + id, valAsset('VAL-008', { ram_gb: '32 GB' }, { type: 'VAL_B' }));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.extendedAttributes, { ram_gb: '32 GB' });

      const details = await lastUpdate(id);
      assert.deepEqual(details.changed, ['type', 'extendedAttributes']);
      assert.deepEqual(details.droppedAttributes, valid);
    });
  });

  test('unknown API routes answer in JSON', async () => {
    const res = await api('GET', '/nope');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });
});

if (skip) console.log('# integration tests skipped: ' + skip);
