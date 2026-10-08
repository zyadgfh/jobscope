'use strict';

// One serverless invocation must stay inside the function duration limit, so the
// retrieval budget has to cut a slow batch short and report what it dropped. The
// network is stubbed here: the point is the budget arithmetic, not HTTP.

const test = require('node:test');
const assert = require('node:assert/strict');

const links = Array.from({ length: 8 }, (_, index) =>
  '<a class="result__a" href="//duckduckgo.com/l/?uddg=' +
  encodeURIComponent(`https://wuzzuf.net/jobs/${index}`) +
  `">Data Entry ${index}</a>`).join('');
const generalLinks = Array.from({ length: 8 }, (_, index) =>
  '<a class="result__a" href="//duckduckgo.com/l/?uddg=' +
  encodeURIComponent(`https://example.org/page-${index}`) +
  `">Result ${index}</a>`).join('');

const postingPage = '<html><head><script type="application/ld+json">' +
  '{"@type":"JobPosting","title":"Data Entry Specialist","hiringOrganization":{"name":"Acme Ltd"},"jobLocation":{"address":{"addressLocality":"Alexandria"}},' +
  '"baseSalary":{"currency":"EGP","value":{"minValue":6000,"maxValue":8000,"unitText":"MONTH"}}}</script></head><body>Data entry</body></html>';

let pageFetches = 0;
const fetcher = {
  fetchPublicSource: async (url) => {
    if (url.includes('duckduckgo.com')) {
      const content = url.includes('jobs') || url.includes('wuzzuf') ? links : generalLinks;
      return { url, canonical_url: url, title: 'search results', contentType: 'text/html', content, contentHash: 'discovery', retrievedAt: new Date().toISOString(), metadata: {} };
    }
    pageFetches += 1;
    // General pages are slower than job-board pages: the window plus the budget
    // must still bound the batch.
    await new Promise(resolve => setTimeout(resolve, url.includes('example.org') ? 700 : 300));
    return {
      url,
      canonical_url: url,
      title: 'page',
      contentType: 'text/html',
      content: url.includes('example.org') ? '<html><head><title>Page ' + url + '</title></head></html>' : postingPage,
      contentHash: 'page',
      retrievedAt: new Date().toISOString(),
      metadata: {}
    };
  }
};

const fetcherPath = require.resolve('../src/application/source-fetcher');
require.cache[fetcherPath] = { id: fetcherPath, filename: fetcherPath, loaded: true, exports: fetcher };
const { searchJobBoard } = require('../src/application/job-board-search');
const { searchWeb } = require('../src/application/generic-web-search');

test('a slow job board is cut off by the batch budget and reports the dropped links', async () => {
  pageFetches = 0;
  const started = Date.now();
  const result = await searchJobBoard('Data Entry', {
    provider: 'wuzzuf',
    domain: 'wuzzuf.net',
    location: 'Alexandria',
    maxResults: 8,
    timeBudgetMs: 1000
  });
  const elapsed = Date.now() - started;

  assert.equal(result.links.length, 8, 'all discovered links are reported');
  assert.equal(result.budgetExhausted, true, 'the budget ended the loop');
  assert.ok(result.skippedLinks >= 3, `expected several skipped links, saw ${result.skippedLinks}`);
  assert.ok(pageFetches < 8, `only part of the batch was fetched (${pageFetches})`);
  assert.ok(elapsed < 2200, `the batch must stop near the budget, took ${elapsed}ms`);
});

test('a generous budget fetches every discovered job page', async () => {
  pageFetches = 0;
  const result = await searchJobBoard('Data Entry', {
    provider: 'wuzzuf',
    domain: 'wuzzuf.net',
    maxResults: 8,
    timeBudgetMs: 30000
  });
  assert.equal(result.budgetExhausted, false);
  assert.equal(result.skippedLinks, 0);
  assert.equal(pageFetches, 8);
  assert.ok(result.jobs.length >= 1, 'a JSON-LD posting is extracted into an opportunity');
});

test('general web search runs page fetches in a bounded window and honours the budget', async () => {
  pageFetches = 0;
  const started = Date.now();
  const result = await searchWeb('climate policy', { maxResults: 8, timeBudgetMs: 1000 });
  const elapsed = Date.now() - started;
  assert.equal(result.links.length, 8);
  assert.equal(result.budgetExhausted, true);
  assert.ok(result.skippedLinks >= 1, `expected skipped links, saw ${result.skippedLinks}`);
  assert.ok(pageFetches < 8, `the window plus the budget must leave work undone (${pageFetches})`);
  assert.ok(elapsed < 2200, `took ${elapsed}ms`);
});
