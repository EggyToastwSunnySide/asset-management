const { checkBody, checkQuery } = require('../validation');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERMISSION_KEY = /^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/;

function readArray(c, name, { pattern, label, max = 100 } = {}) {
  const raw = c.input[name];
  if (!Array.isArray(raw)) return c.fail(name, 'Must be an array');
  if (raw.length > max) return c.fail(name, `Must contain at most ${max} items`);
  const seen = new Set();
  const values = [];
  for (let index = 0; index < raw.length; index += 1) {
    const value = raw[index];
    if (typeof value !== 'string' || !pattern.test(value)) {
      c.fail(`${name}[${index}]`, `Must be a valid ${label}`);
      continue;
    }
    if (seen.has(value)) {
      c.fail(`${name}[${index}]`, `Duplicate ${label}`);
      continue;
    }
    seen.add(value);
    values.push(value);
  }
  return values;
}

function readPermissionKeys(c) {
  return readArray(c, 'permissionKeys', { pattern: PERMISSION_KEY, label: 'permission key' });
}

function parseCreateRole(body) {
  const c = checkBody(body, ['name', 'description', 'permissionKeys']);
  const value = {
    name: c.string('name', { max: 100 }),
    description: c.string('description', { required: false, max: 500, fallback: null }),
    permissionKeys: readPermissionKeys(c),
  };
  return c.done(value);
}

function parseUpdateRole(body) {
  const c = checkBody(body, ['name', 'description', 'isActive', 'permissionKeys']);
  const value = {
    name: c.string('name', { max: 100 }),
    description: c.string('description', { required: false, max: 500, fallback: null }),
    isActive: c.boolean('isActive'),
    permissionKeys: readPermissionKeys(c),
  };
  return c.done(value);
}

function parseRoleAssignment(body) {
  const c = checkBody(body, ['roleIds']);
  const value = {
    roleIds: readArray(c, 'roleIds', { pattern: UUID, label: 'role id' }),
  };
  return c.done(value);
}

function parseUserListQuery(query) {
  const c = checkQuery(query);
  return c.done({
    search: c.string('search', { required: false, max: 100, fallback: null }),
    page: c.integer('page', { min: 1, fallback: 1 }),
    pageSize: c.integer('pageSize', { min: 1, max: 100, fallback: 25 }),
  });
}

module.exports = { parseCreateRole, parseRoleAssignment, parseUpdateRole, parseUserListQuery };
