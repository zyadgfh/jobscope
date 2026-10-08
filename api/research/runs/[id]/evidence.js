const { call, normalizeToken } = require('../../../../src/infrastructure/research-control-client');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  const token = normalizeToken(req.headers.authorization);
  if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' });
  const body = req.body || {};
  // Manually supplied evidence can never claim cross-source verification.
  const evidence = Array.isArray(body.evidence)
    ? body.evidence.map(item => ({
      ...item,
      status: item.status === 'verified_fact' ? 'reported' : (item.status || 'reported'),
      provenance: { ...(item.provenance || {}), retrievalMethod: 'manual_user_supplied' }
    }))
    : [];
  res.setHeader('cache-control', 'no-store');
  try {
    return res.status(200).json(await call({
      op: 'ingest',
      evidence,
      jobs: Array.isArray(body.jobs) ? body.jobs : [],
      sources: Array.isArray(body.sources) ? body.sources : []
    }, { token }));
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'BAD_REQUEST', message: error.message });
  }
};
