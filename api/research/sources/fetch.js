const { fetchPublicSource } = require('../../../src/application/source-fetcher');
const { normalizeToken, isPlausibleToken } = require('../../../src/infrastructure/research-control-client');

const WINDOW_MS = 60000;
const MAX_PER_WINDOW = 10;
const buckets = new Map();

const STATUS_BY_CODE = {
  INVALID_URL: 400,
  UNSUPPORTED_PROTOCOL: 400,
  UNSAFE_URL: 400,
  SSRF_BLOCKED: 400,
  SOURCE_NOT_REGISTERED: 403,
  CONTENT_TYPE_BLOCKED: 415,
  RESPONSE_TOO_LARGE: 413,
  REDIRECT_BLOCKED: 502,
  SOURCE_HTTP_ERROR: 502,
  SOURCE_TIMEOUT: 504,
  HOST_RESOLUTION_FAILED: 502,
  SOURCE_REQUEST_FAILED: 502
};

function rateLimited(ip) {
  const now = Date.now();
  const bucket = buckets.get(ip) || { at: now, count: 0 };
  if (now - bucket.at > WINDOW_MS) {
    bucket.at = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  buckets.set(ip, bucket);
  if (buckets.size > 5000) buckets.clear();
  return bucket.count > MAX_PER_WINDOW;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  // Retrieval is a run-scoped capability, not an anonymous open relay.
  const token = normalizeToken(req.headers.authorization);
  if (!token || !isPlausibleToken(token)) return res.status(401).json({ error: 'UNAUTHORIZED' });
  const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  if (rateLimited(ip)) return res.status(429).json({ error: 'RATE_LIMITED' });
  res.setHeader('cache-control', 'no-store');
  try {
    const body = req.body || {};
    const document = await fetchPublicSource(String(body.url || ''));
    return res.status(200).json({ document });
  } catch (error) {
    const status = STATUS_BY_CODE[error.code] || 502;
    return res.status(status).json({ error: error.code || 'SOURCE_FETCH_FAILED', message: error.message });
  }
};
