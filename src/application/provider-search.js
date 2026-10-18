const { searchWeb } = require('./generic-web-search');

function clean(value, max = 2000) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

async function brave(query, { location = '', maxResults = 8 } = {}) {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) throw new Error('BRAVE_SEARCH_API_KEY is not configured');
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', [query, location].filter(Boolean).join(' '));
  url.searchParams.set('count', String(Math.min(maxResults, 20)));
  const response = await fetch(url, { headers: { accept: 'application/json', 'x-subscription-token': key } });
  if (!response.ok) throw new Error(`Brave Search failed: ${response.status}`);
  const data = await response.json();
  const results = Array.isArray(data.web?.results) ? data.web.results : [];
  const sources = results.map((item, index) => ({
    sourceKey: `brave:${index}:${item.url}`,
    canonical_url: item.url,
    source_type: 'search_engine',
    reliability: .68,
    metadata: { provider: 'brave', query, title: clean(item.title, 500) }
  }));
  const evidence = results.map((item, index) => ({
    claim: clean(`${item.title || 'Search result'}: ${item.description || ''}`, 1800),
    sourceId: `brave:${index}:${item.url}`,
    status: 'reported',
    confidence: .62,
    provenance: { url: item.url, retrievalMethod: 'brave_api', evidenceKey: `brave:${item.url}` }
  }));
  return { sources, documents: [], jobs: [], evidence, links: results.map(item => ({ url: item.url, title: item.title })) };
}

async function tavily(query, { location = '', maxResults = 8 } = {}) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error('TAVILY_API_KEY is not configured');
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: key, query: [query, location].filter(Boolean).join(' '), max_results: Math.min(maxResults, 20), include_answer: false })
  });
  if (!response.ok) throw new Error(`Tavily Search failed: ${response.status}`);
  const data = await response.json();
  const results = Array.isArray(data.results) ? data.results : [];
  const sources = results.map((item, index) => ({
    sourceKey: `tavily:${index}:${item.url}`,
    canonical_url: item.url,
    source_type: 'search_engine',
    reliability: .67,
    metadata: { provider: 'tavily', query, title: clean(item.title, 500) }
  }));
  const evidence = results.map((item, index) => ({
    claim: clean(`${item.title || 'Search result'}: ${item.content || ''}`, 1800),
    sourceId: `tavily:${index}:${item.url}`,
    status: 'reported',
    confidence: Math.max(.45, Math.min(.9, Number(item.score || .6))),
    provenance: { url: item.url, retrievalMethod: 'tavily_api', evidenceKey: `tavily:${item.url}` }
  }));
  return { sources, documents: [], jobs: [], evidence, links: results.map(item => ({ url: item.url, title: item.title })) };
}

async function searchWithProviders(query, options = {}) {
  const configured = [
    ['brave', brave], ['tavily', tavily], ['duckduckgo', searchWeb]
  ].filter(([provider]) => options.providers ? options.providers.includes(provider) : true);
  const errors = [];
  for (const [provider, search] of configured) {
    try {
      const result = await search(query, options);
      return { ...result, provider, providerErrors: errors };
    } catch (error) {
      errors.push({ provider, message: String(error.message || error) });
    }
  }
  throw Object.assign(new Error('All configured search providers failed'), { code: 'SEARCH_PROVIDERS_FAILED', providerErrors: errors });
}

module.exports = { brave, tavily, searchWithProviders };
