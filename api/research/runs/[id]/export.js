const { call, normalizeToken } = require('../../../../src/infrastructure/research-control-client');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  const token = normalizeToken(req.headers.authorization);
  if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' });
  try {
    const data = await call({ op: 'snapshot' }, { token });
    const payload = { exportVersion: '1.1', exportedAt: new Date().toISOString(), ...data };
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-disposition', 'attachment; filename="jobscope-research.json"');
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'EXPORT_FAILED', message: error.message });
  }
};
