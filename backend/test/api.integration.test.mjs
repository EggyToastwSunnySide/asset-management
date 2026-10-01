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

async function api(method, path, body) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
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

describe('asset management API', { skip: skip || false }, () => {
  before(async () => {
    const app = require('../app');
    pool = require('../db/pool').pool;
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
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
    async function exportSheet(body) {
      const res = await api('POST', '/exports/assets', body);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.match(res.headers.get('content-type'), /spreadsheetml/);
      assert.match(res.headers.get('content-disposition'), /attachment; filename="inventory-export-\d{4}-\d{2}-\d{2}\.xlsx"/);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body);
      return { sheet: workbook.getWorksheet('Assets'), rowCount: Number(res.headers.get('x-export-row-count')) };
    }

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

  test('unknown API routes answer in JSON', async () => {
    const res = await api('GET', '/nope');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });
});

if (skip) console.log('# integration tests skipped: ' + skip);
