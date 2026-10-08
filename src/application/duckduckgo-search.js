'use strict';
const { fetchPublicSource } = require('./source-fetcher');

const DISCOVERY_BASE = 'https://html.duckduckgo.com/';
const MAX_RESULTS = 8;

function buildDiscoveryUrl(query) {
  return DISCOVERY_BASE + 'html/?q=' + encodeURIComponent(String(query || '').trim());
}

function decodeRedirect(rawHref) {
  try {
    // DuckDuckGo emits protocol-relative hrefs; resolve them against the base.
    const url = new URL(String(rawHref || ''), DISCOVERY_BASE);
    const wrapped = url.searchParams.get('uddg');
    if (wrapped) return new URL(wrapped).toString();
    return url.toString();
  } catch {
    return null;
  }
}

function extractResultLinks(html, { maxResults = MAX_RESULTS } = {}) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(String(html || ''))) && out.length < maxResults) {
    const url = decodeRedirect(match[1]);
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      if (/(^|\.)duckduckgo\.com$/i.test(parsed.hostname)) continue;
      if (seen.has(parsed.toString())) continue;
      seen.add(parsed.toString());
      out.push({ url: parsed.toString(), title: stripTags(match[2]) });
    } catch {
      continue;
    }
  }
  return out;
}

function stripTags(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function discoverLinks(query, { maxResults = MAX_RESULTS, timeoutMs } = {}) {
  const discoveryUrl = buildDiscoveryUrl(query);
  const discovery = await fetchPublicSource(discoveryUrl, { timeoutMs: timeoutMs || 9000, maxBytes: 1000000 });
  return { discoveryUrl, discovery, links: extractResultLinks(discovery.content, { maxResults }) };
}

module.exports = { DISCOVERY_BASE, buildDiscoveryUrl, decodeRedirect, extractResultLinks, stripTags, discoverLinks };
