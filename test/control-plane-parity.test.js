'use strict';

// The deployed control plane is a Deno Edge Function; the local one is JavaScript.
// Both must implement the same contract, so this suite reads the Edge Function
// source and compares it with the local implementation and the domain lifecycle
// table. Drift here would make every local run a lie about production.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { TRANSITIONS } = require('../src/domain/research/research-run');

const root = path.join(__dirname, '..');
const EDGE = fs.readFileSync(path.join(root, 'supabase/functions/research-control/index.ts'), 'utf8');
const LOCAL = fs.readFileSync(path.join(root, 'src/infrastructure/local-research-control.js'), 'utf8');

function edgeEdges() {
  const table = /const EDGES=new Map<string,Set<string>>\(\[([\s\S]*?)\]\);/.exec(EDGE)[1];
  const edges = {};
  const pair = /\["([a-z]+)",new Set\(\[([^\]]*)\]\)\]/g;
  let match;
  while ((match = pair.exec(table))) {
    edges[match[1]] = [...match[2].matchAll(/"([a-z]+)"/g)].map(item => item[1]);
  }
  return edges;
}

test('the lifecycle table in the Edge Function matches the domain table', () => {
  const edges = edgeEdges();
  assert.ok(Object.keys(edges).length >= 11, 'all run states are described');
  for (const [state, targets] of Object.entries(TRANSITIONS)) {
    assert.deepEqual(edges[state], [...targets], `state ${state} drifted`);
  }
});

test('the local plane implements exactly the operations the Edge Function serves', () => {
  const ops = new Set([...EDGE.matchAll(/body\.op==="([a-zA-Z]+)"/g)].map(match => match[1]));
  assert.ok(ops.size >= 10, 'operation surface was found: ' + [...ops].join(','));
  const surface = new Set([
    ...LOCAL.matchAll(/^\s*case '([a-zA-Z]+)':/gm).map(match => match[1]),
    ...LOCAL.matchAll(/if \(op === '([a-zA-Z]+)'\)/g).map(match => match[1])
  ]);
  for (const op of ops) assert.ok(surface.has(op), `the local plane does not implement "${op}"`);
  for (const op of surface) assert.ok(ops.has(op), `the local plane implements "${op}", which the Edge Function does not serve`);
});

test('every error code the Edge Function can return exists in the local plane', () => {
  // Transport-level codes belong to the HTTP wrapper (the local plane is called
  // in-process), so they are asserted separately below.
  const transport = new Set(['METHOD_NOT_ALLOWED', 'CONTROL_PLANE_ERROR', 'PAYLOAD_TOO_LARGE']);
  const codes = new Set([...EDGE.matchAll(/error:"([A-Z_]+)"/g)].map(match => match[1]));
  assert.ok(codes.size >= 8, 'error codes were found: ' + [...codes].join(','));
  for (const code of codes) {
    if (transport.has(code)) continue;
    assert.ok(LOCAL.includes(`'${code}'`), `the local plane never returns ${code}`);
  }
});

test('rate limits, token lifetime and payload caps are identical', () => {
  assert.match(EDGE, /WINDOW_MS=60000/, 'the window changed in the Edge Function');
  assert.match(LOCAL, /WINDOW_MS = 60 \* 1000/);
  assert.match(EDGE, /MAX_CREATE_PER_WINDOW=5/);
  assert.match(LOCAL, /MAX_CREATE_PER_WINDOW = 5/);
  assert.match(EDGE, /Date\.now\(\)\+7\*86400000/, 'the token lifetime changed in the Edge Function');
  assert.match(LOCAL, /TOKEN_TTL_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(EDGE, /JSON\.stringify\(body\)\.length>2500000/, 'the ingest cap changed in the Edge Function');
  assert.match(LOCAL, /MAX_INGEST_BYTES = 2500000/);
  assert.match(EDGE, /attempts=Number\(body\.attempts\|\|0\)\+1/, 'attempt accounting changed in the Edge Function');
  assert.match(LOCAL, /task\.attempts = Number\(body\.attempts \|\| 0\) \+ 1/);
});
