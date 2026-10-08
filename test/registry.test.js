'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findSource, listSources, UNREGISTERED_SOURCE } = require('../src/domain/research/source-registry');

test('the discovery engine is a registered source', () => {
  const source = findSource('https://html.duckduckgo.com/html/?q=data+entry');
  assert.ok(source, 'search discovery must be allowed to fetch its own endpoint');
  assert.equal(source.id, 'duckduckgo');
  assert.equal(source.kind, 'search_engine');
});

test('job boards resolve to their canonical source ids', () => {
  assert.equal(findSource('https://wuzzuf.net/jobs/p/123').id, 'wuzzuf');
  assert.equal(findSource('https://www.forasna.com/job/1').id, 'forasna');
  assert.equal(findSource('https://www.linkedin.com/jobs/view/1').id, 'linkedin');
});

test('unrelated domains are not registered', () => {
  assert.equal(findSource('https://example.com/page'), null);
  assert.equal(findSource('not a url'), null);
  assert.equal(findSource('https://notwuzzuf.net/jobs'), null, 'suffix matching must respect the dot boundary');
});

test('the unregistered fallback is explicit and conservative', () => {
  assert.equal(UNREGISTERED_SOURCE.id, 'web_public');
  assert.equal(UNREGISTERED_SOURCE.reliability < .75, true);
  assert.equal(listSources().some(source => source.id === 'web_public'), false);
});

test('listed sources expose copies, never the mutable originals', () => {
  const first = listSources();
  first[0].domains.push('evil.example');
  assert.equal(listSources()[0].domains.includes('evil.example'), false);
});
