'use strict';

/*
 * Shared execution core. `POST /api/research/runs/execute/:id` is the only route
 * that reaches it on Vercel; the local server also exposes
 * `POST /api/research/runs/:id?action=execute` so the request lifecycle can be
 * driven without a filesystem-router.
 */

const { call, normalizeToken, isPlausibleToken } = require('../infrastructure/research-control-client');
const { executeBatch } = require('../application/research-executor');

async function executeRun(req, res) {
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
      // The run may not allow the transition, or the token may be invalid.
    }
    return res.status(error.status || 500).json({ error: error.code || 'RESEARCH_EXECUTION_FAILED', message: error.message });
  }
}

module.exports = { executeRun };
