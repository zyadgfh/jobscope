'use strict';
const { fetchPublicSource } = require('./source-fetcher');
const { strip } = require('../domain/research/jobposting-extractor');
const { DISCOVERY_BASE, buildDiscoveryUrl, extractResultLinks } = require('./duckduckgo-search');
const { createBudget, searchBudgetMs } = require('../core/time');

const STORED_CONTENT_LIMIT = 200000;

function extractGeneralClaims(html, url) {
  const claims = [];
  const title = (String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const description = (String(html || '').match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1];
  if (title) claims.push({ claim: 'Page title states: ' + strip(title).slice(0, 500), status: 'reported', confidence: .7, provenance: { url, extraction: 'html-title', evidenceKey: 'title:' + url } });
  if (description) claims.push({ claim: 'Page description states: ' + strip(description).slice(0, 1000), status: 'reported', confidence: .65, provenance: { url, extraction: 'meta-description', evidenceKey: 'description:' + url } });
  return claims;
}

function truncateDocument(document) {
  return {
    ...document,
    content: String(document.content || '').slice(0, STORED_CONTENT_LIMIT),
    metadata: { ...(document.metadata || {}), storedContentTruncated: String(document.content || '').length > STORED_CONTENT_LIMIT }
  };
}

async function searchWeb(query, { location = '', maxResults = 3, timeoutMs, timeBudgetMs } = {}) {
  const budget = createBudget(searchBudgetMs(timeBudgetMs));
  const combined = [query, location].filter(Boolean).join(' ');
  const discoveryUrl = buildDiscoveryUrl(combined);
  const discovery = await fetchPublicSource(discoveryUrl, { timeoutMs: timeoutMs || 9000, maxBytes: 1000000 });
  const links = extractResultLinks(discovery.content, { maxResults });

  const sources = [{
    sourceKey: 'ddg',
    canonical_url: discoveryUrl,
    source_type: 'search_engine',
    reliability: .6,
    metadata: { provider: 'duckduckgo', query, location }
  }];
  const documents = [truncateDocument(discovery)];
  const evidence = [];

  // Page fetches run in a small window so a slow page cannot stretch the batch,
  // and the shared budget stops the loop once it is spent.
  const queue = [...links];
  let skipped = 0;
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      if (budget.expired()) {
        skipped += queue.length;
        queue.length = 0;
        return;
      }
      const link = queue.shift();
      try {
        const doc = await fetchPublicSource(link.url, { timeoutMs: timeoutMs || 8000, maxBytes: 1000000, allowUnregistered: true });
        const sourceKey = 'page:' + link.url;
        sources.push({ sourceKey, canonical_url: link.url, source_type: 'web', reliability: .5, metadata: { provider: 'web_public', discoveredBy: 'duckduckgo', query, location, title: link.title } });
        documents.push(truncateDocument(doc));
        evidence.push(...extractGeneralClaims(doc.content, link.url).map(claim => ({ ...claim, sourceId: sourceKey })));
      } catch {
        // A single unreachable page must not discard the rest of the batch.
      }
    }
  });
  await Promise.all(workers);

  return { sources, documents, evidence, links, budgetExhausted: skipped > 0, skippedLinks: skipped };
}

module.exports = { searchWeb, extractResultLinks, extractGeneralClaims, DISCOVERY_BASE, buildDiscoveryUrl };
