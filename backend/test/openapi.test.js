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
