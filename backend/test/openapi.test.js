const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const vm = require('node:vm');
const { ROUTES } = require('../api');
const spec = require('../api/openapi');

const METHODS = ['get', 'post', 'put', 'delete', 'patch'];

/** Every `METHOD /path` the Express routers actually serve, in OpenAPI path syntax. */
function mountedOperations() {
  const ops = new Set();
  for (const [mount, router] of ROUTES) {
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const path = (mount + (layer.route.path === '/' ? '' : layer.route.path)).replace(/:(\w+)/g, '{$1}');
      for (const method of Object.keys(layer.route.methods)) ops.add(`${method.toUpperCase()} ${path}`);
    }
  }
  return ops;
}

function documentedOperations() {
  const ops = new Set();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) if (item[method]) ops.add(`${method.toUpperCase()} ${path}`);
  }
  return ops;
}

test('every mounted route is documented, and every documented route is mounted', () => {
  assert.deepEqual([...mountedOperations()].sort(), [...documentedOperations()].sort());
});

test('every $ref resolves', () => {
  const refs = JSON.stringify(spec).match(/"\$ref":"[^"]+"/g) || [];
  for (const raw of refs) {
    const pointer = raw.slice(8, -1).replace(/^#\//, '').split('/');
    let node = spec;
    for (const part of pointer) node = node && node[part];
    assert.ok(node, 'unresolved ' + raw);
  }
});

test('authentication is default-deny with explicit public operation overrides', () => {
  assert.deepEqual(spec.security, [{ cookieAuth: [] }]);
  assert.equal(spec.components.securitySchemes.cookieAuth.in, 'cookie');
  const publicOperations = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      if (item[method] && item[method].security && item[method].security.length === 0) {
        publicOperations.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  assert.deepEqual(publicOperations.sort(), ['GET /health', 'POST /auth/sign-in']);
});

test('protected operations document auth errors and unsafe methods document CSRF', () => {
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation || (operation.security && operation.security.length === 0)) continue;
      assert.ok(operation.responses[401], `${method.toUpperCase()} ${path} misses 401`);
      assert.ok(operation.responses[403], `${method.toUpperCase()} ${path} misses 403`);
      assert.ok(operation.responses[429], `${method.toUpperCase()} ${path} misses 429`);
      if (['post', 'put', 'patch', 'delete'].includes(method)) {
        assert.ok(
          (operation.parameters || []).some((parameter) => parameter.$ref === '#/components/parameters/CsrfToken'),
          `${method.toUpperCase()} ${path} misses CSRF header`,
        );
      }
    }
  }
});

test('every permission-protected operation declares its policy', () => {
  const expected = new Set([
    'GET /reference-data',
    'POST /asset-types', 'GET /asset-types/{code}',
    'GET /asset-types/{code}/attributes', 'POST /asset-types/{code}/attributes',
    'PUT /asset-types/{code}/attributes/{key}', 'DELETE /asset-types/{code}/attributes/{key}',
    'POST /asset-types/{code}/attributes/{key}/restore',
    'GET /assets', 'POST /assets', 'GET /assets/{id}', 'PUT /assets/{id}', 'DELETE /assets/{id}',
    'POST /assets/{id}/restore', 'POST /exports/assets',
    'GET /export-profiles', 'POST /export-profiles', 'GET /export-profiles/{id}',
    'PUT /export-profiles/{id}', 'DELETE /export-profiles/{id}',
    'GET /permissions', 'GET /roles', 'POST /roles', 'GET /roles/{id}', 'PUT /roles/{id}',
    'GET /users', 'PUT /users/{id}/roles',
  ]);
  const actual = new Set();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      if (item[method] && item[method]['x-required-permissions']) actual.add(`${method.toUpperCase()} ${path}`);
    }
  }
  assert.deepEqual([...actual].sort(), [...expected].sort());
});

test('serves the document and Swagger UI', async () => {
  const app = require('../app');
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const doc = await fetch(base + '/openapi.json');
    assert.equal(doc.status, 200);
    assert.equal((await doc.json()).openapi, '3.1.0');

    const ui = await fetch(base + '/docs/');
    assert.equal(ui.status, 200);
    assert.match(await ui.text(), /swagger-ui/);

    // Swagger UI renders a blank page if this script does not compile.
    const init = await fetch(base + '/docs/swagger-ui-init.js');
    assert.equal(init.status, 200);
    const initJs = await init.text();
    assert.doesNotThrow(() => new vm.Script(initJs), 'swagger-ui-init.js does not compile');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    http.globalAgent.destroy();
  }
});
