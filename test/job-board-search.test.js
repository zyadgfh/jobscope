'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractResultLinks } = require('../src/application/job-board-search');

test('job board discovery decodes DuckDuckGo wrapped links', () => {
  const html = '<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwuzzuf.net%2Fjobs%2Fp%2F123">Data Entry</a>';
  const result = extractResultLinks(html);
  assert.equal(result[0].url, 'https://wuzzuf.net/jobs/p/123');
  assert.equal(result[0].title, 'Data Entry');
});

test('protocol-relative redirect hrefs are resolved (the shape DuckDuckGo actually returns)', () => {
  const html = '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwuzzuf.net%2Fjobs%2Fp%2F123">Data Entry</a>';
  const result = extractResultLinks(html);
  assert.equal(result.length, 1);
  assert.equal(result[0].url, 'https://wuzzuf.net/jobs/p/123');
});

test('discovery ignores DuckDuckGo internal links and duplicates', () => {
  const html = [
    '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwuzzuf.net%2Fjobs%2Fp%2F1">One</a>',
    '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwuzzuf.net%2Fjobs%2Fp%2F1">One again</a>',
    '<a class="result__a" href="https://duckduckgo.com/html/?q=more">More results</a>',
    '<a class="result__a" href="https://forasna.com/jobs/42">Forasna role</a>'
  ].join('');
  const result = extractResultLinks(html);
  assert.deepEqual(result.map(link => link.url), ['https://wuzzuf.net/jobs/p/1', 'https://forasna.com/jobs/42']);
});

test('malformed and non-http hrefs never become results', () => {
  const html = [
    '<a class="result__a" href="javascript:alert(1)">x</a>',
    '<a class="result__a" href="mailto:jobs@example.com">mail</a>',
    '<a class="result__a" href="::not a url::">broken</a>'
  ].join('');
  assert.deepEqual(extractResultLinks(html), []);
});

test('the discovery URL is built against the registered DuckDuckGo host', () => {
  const { buildDiscoveryUrl, DISCOVERY_BASE } = require('../src/application/job-board-search');
  const url = new URL(buildDiscoveryUrl('Data Entry Alexandria'));
  assert.equal(url.origin, new URL(DISCOVERY_BASE).origin);
  assert.equal(url.searchParams.get('q'), 'Data Entry Alexandria');
});
