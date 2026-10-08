'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Every deployed handler must be requirable: a wrong relative path (or a typo in
// a require) breaks a production route while unit tests keep passing.
process.env.RESEARCH_CONTROL_URL = process.env.RESEARCH_CONTROL_URL || 'local';
process.env.JOBSCOPE_LOCAL_STORE = path.join(require('node:os').tmpdir(), `jobscope-graph-${process.pid}.json`);

const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

function collect(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('every api/ and src/ module can be required', () => {
  const files = [
    ...collect(path.join(root, 'api')),
    ...collect(path.join(root, 'src'))
  ];
  assert.ok(files.length > 20, 'sanity: the module set was found');
  const failures = [];
  for (const file of files) {
    try {
      require(file);
    } catch (error) {
      failures.push(`${path.relative(root, file)}: ${error.message}`);
    }
  }
  assert.deepEqual(failures, [], 'modules fail to load:\n' + failures.join('\n'));
});

test('the server boots on an ephemeral port and serves the app', async () => {
  const { start, createServer } = require('../server.js');
  assert.equal(typeof createServer, 'function');
  const server = await start(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-security-policy') || '', /default-src 'self'/);
    const health = await fetch(base + '/api/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).app, 'jobscope');
    const blocked = await fetch(base + '/package.json');
    assert.equal(blocked.status, 404, 'the static server is an allowlist, not the repository');
    const traversal = await fetch(base + '/%2e%2e/%2e%2e/etc/passwd');
    assert.equal(traversal.status, 404);
  } finally {
    server.close();
  }
});

test('local routing matches the deployed file layout', () => {
  const { findRoute } = require('../src/api/research-routes');
  const expected = [
    ['GET', '/api/health', 'api/health.js'],
    ['POST', '/api/research/runs', 'api/research/runs/index.js'],
    ['POST', '/api/research/runs/execute/ID', 'api/research/runs/execute/[id].js'],
    ['POST', '/api/research/runs/ID/evidence', 'api/research/runs/[id]/evidence.js'],
    ['GET', '/api/research/runs/ID/export', 'api/research/runs/[id]/export.js'],
    ['GET', '/api/research/runs/ID', 'api/research/runs/[id].js'],
    ['POST', '/api/research/runs/ID', 'api/research/runs/[id].js'],
    ['POST', '/api/research/sources/fetch', 'api/research/sources/fetch.js']
  ];
  for (const [method, url, file] of expected) {
    const route = findRoute(method, url.replace('ID', 'run-1234'));
    assert.ok(route, `${method} ${url} has no route`);
    const loaded = Object.values(require.cache).find(entry => entry.exports === route.handler);
    assert.ok(loaded, `${method} ${url} is served by an anonymous handler`);
    assert.equal(loaded.filename, path.join(root, file), `${url} must be served by ${file}`);
  }
});

test('no source file imports a module that no longer exists', () => {
  const files = collect(root).filter(file => !file.includes(`${path.sep}node_modules${path.sep}`));
  const missing = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      const resolved = path.resolve(path.dirname(file), match[1]);
      if (!fs.existsSync(resolved) && !fs.existsSync(resolved + '.js') && !fs.existsSync(resolved + '.json')) {
        missing.push(`${path.relative(root, file)} -> ${match[1]}`);
      }
    }
  }
  assert.deepEqual(missing, [], 'broken relative requires:\n' + missing.join('\n'));
});
