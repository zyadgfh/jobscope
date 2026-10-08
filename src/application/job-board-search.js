'use strict';
const { fetchPublicSource } = require('./source-fetcher');
const { strip, extractJobPostings } = require('../domain/research/jobposting-extractor');
const { SOURCES } = require('../domain/research/source-registry');
const { DISCOVERY_BASE, buildDiscoveryUrl, decodeRedirect, extractResultLinks, stripTags } = require('./duckduckgo-search');
const { createBudget, searchBudgetMs } = require('../core/time');

const STORED_CONTENT_LIMIT = 250000;

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function matchesDomains(url, domains) {
  if (!domains.length) return true;
  const host = hostnameOf(url).toLowerCase();
  return domains.some(d => host === d || host.endsWith('.' + d));
}

async function discover(query, { domains = [], maxResults = 8, timeoutMs } = {}) {
  const constrained = domains.length ? 'site:' + domains[0] + ' ' + query : query;
  const discoveryUrl = buildDiscoveryUrl(constrained);
  const discovery = await fetchPublicSource(discoveryUrl, { timeoutMs: timeoutMs || 9000, maxBytes: 1000000 });
  const links = extractResultLinks(discovery.content, { maxResults: maxResults * 2 })
    .filter(link => matchesDomains(link.url, domains))
    .slice(0, maxResults);
  return { discoveryUrl, discovery, links };
}

function makeSource(url, provider, query, location, reliability) {
  return {
    sourceKey: provider + ':' + hostnameOf(url),
    canonical_url: url,
    source_type: 'job_board',
    reliability,
    metadata: { provider, query, location }
  };
}

function truncateDocument(document) {
  return {
    ...document,
    content: String(document.content || '').slice(0, STORED_CONTENT_LIMIT),
    metadata: { ...(document.metadata || {}), storedContentTruncated: String(document.content || '').length > STORED_CONTENT_LIMIT }
  };
}

async function searchJobBoard(query, { location = '', provider, domain, maxResults = 4, timeoutMs, timeBudgetMs } = {}) {
  const budget = createBudget(searchBudgetMs(timeBudgetMs));
  const source = SOURCES.find(x => x.id === provider);
  if (!source) throw Object.assign(new Error('unknown job provider'), { code: 'UNKNOWN_PROVIDER' });

  const discovered = await discover([query, location].filter(Boolean).join(' '), { domains: [domain], maxResults, timeoutMs });
  const sources = [
    { sourceKey: provider, canonical_url: 'https://' + domain, source_type: 'job_board', reliability: source.reliability, metadata: { provider, domain, query, location, role: 'canonical_provider' } },
    { sourceKey: provider + ':search', canonical_url: discovered.discoveryUrl, source_type: 'search_engine', reliability: .6, metadata: { provider: 'duckduckgo', board: provider, query, location } }
  ];
  const documents = [truncateDocument(discovered.discovery)];
  const jobs = [];
  const evidence = [];

  let skipped = 0;
  for (const link of discovered.links) {
    if (budget.expired()) {
      skipped = discovered.links.length - (documents.length - 1);
      break;
    }
    try {
      const doc = await fetchPublicSource(link.url, { timeoutMs: timeoutMs || 8000, maxBytes: 1000000, allowUnregistered: true });
      const sourceKey = provider + ':page:' + encodeURIComponent(link.url).slice(0, 80);
      sources.push({ ...makeSource(link.url, provider, query, location, source.reliability), sourceKey });
      documents.push(truncateDocument(doc));
      for (const raw of extractJobPostings(doc.content, link.url)) {
        const jobUrl = raw.url || link.url;
        jobs.push({ ...raw, sourceId: provider, url: jobUrl, retrievedAt: doc.retrievedAt });
        evidence.push({
          claim: 'Source ' + source.name + ' lists a job opportunity: ' + (raw.title || link.title),
          sourceId: provider,
          status: 'reported',
          confidence: raw.confidence,
          provenance: { url: jobUrl, retrievalMethod: 'indexed_public_page', extraction: raw.extraction }
        });
      }
    } catch {
      // A single unreachable posting must not discard the rest of the batch.
    }
  }
  return {
    documents,
    sources,
    jobs,
    evidence,
    links: discovered.links,
    budgetExhausted: skipped > 0,
    skippedLinks: Math.max(0, skipped)
  };
}

module.exports = { discover, extractResultLinks, decodeRedirect, stripTags, searchJobBoard, DISCOVERY_BASE, buildDiscoveryUrl };
