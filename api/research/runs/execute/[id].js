const { call, normalizeToken, isPlausibleToken } = require('../../../../src/infrastructure/research-control-client');
const { executeBatch } = require('../../../../src/application/research-executor');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  const token = normalizeToken(req.headers.authorization);
  if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' });
  // Shape validation only: authority is proven by the control plane comparing the
  // SHA-256 hash of the token. Access tokens are opaque, not JWTs.
  if (!isPlausibleToken(token)) return res.status(401).json({ error: 'INVALID_ACCESS_TOKEN' });
  res.setHeader('cache-control', 'no-store');
  try {
    const { status, payload } = await executeBatch(token);
    return res.status(status).json(payload);
  } catch (error) {
    try {
      await call({ op: 'transition', target: 'failed' }, { token });
    } catch {
      // The run may not be in a state that allows failure, or the token may be invalid.
    }
    return res.status(error.status || 500).json({ error: error.code || 'RESEARCH_EXECUTION_FAILED', message: error.message });
  }
};
