const { call, normalizeToken } = require('../../../src/infrastructure/research-control-client');

const FORWARDED_ACTIONS = new Set(['pause', 'resume', 'cancel', 'fork', 'replay', 'retry', 'compare']);
// Actions are user verbs; the state machine works with state names.
const TRANSITION_TARGETS = { pause: 'paused', cancel: 'cancelled', resume: 'resume' };

module.exports = async function handler(req, res) {
  const token = normalizeToken(req.headers.authorization);
  if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' });
  res.setHeader('cache-control', 'no-store');
  try {
    if (req.method === 'GET') return res.status(200).json(await call({ op: 'get' }, { token }));
    if (req.method === 'POST') {
      const action = String(req.query.action || '').trim();
      if (!FORWARDED_ACTIONS.has(action)) return res.status(400).json({ error: 'INVALID_ACTION' });
      if (action === 'compare') return res.status(200).json(await call({ op: 'compare', otherToken: req.body?.otherToken }, { token }));
      if (action === 'fork' || action === 'replay' || action === 'retry') return res.status(201).json(await call({ op: action }, { token }));
      return res.status(200).json(await call({ op: 'transition', target: TRANSITION_TARGETS[action] }, { token }));
    }
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'BAD_REQUEST', message: error.message });
  }
};
