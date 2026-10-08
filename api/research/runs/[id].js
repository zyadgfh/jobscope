const { call, normalizeToken } = require('../../../src/infrastructure/research-control-client');

// Actions are user verbs; the state machine works with state names.
const ACTION_TARGETS = { pause: 'paused', resume: 'resume', cancel: 'cancelled' };
const SPAWNING_ACTIONS = new Set(['fork', 'replay', 'retry']);

module.exports = async function handler(req, res) {
  const token = normalizeToken(req.headers.authorization);
  if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' });
  res.setHeader('cache-control', 'no-store');
  try {
    if (req.method === 'GET') return res.status(200).json(await call({ op: 'get' }, { token }));
    if (req.method === 'POST') {
      const action = String(req.query.action || '').trim();
      if (action === 'execute') {
        // The local server exposes the batch loop through the action query; on Vercel
        // the canonical route is api/research/runs/execute/[id].js. Both share one core.
        const { executeRun } = require('../../../src/api/execute-core');
        return executeRun(req, res);
      }
      if (action === 'compare') {
        return res.status(200).json(await call({ op: 'compare', otherToken: req.body?.otherToken }, { token }));
      }
      if (SPAWNING_ACTIONS.has(action)) {
        return res.status(201).json(await call({ op: action }, { token }));
      }
      if (ACTION_TARGETS[action]) {
        return res.status(200).json(await call({ op: 'transition', target: ACTION_TARGETS[action] }, { token }));
      }
      return res.status(400).json({ error: 'INVALID_ACTION' });
    }
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'BAD_REQUEST', message: error.message });
  }
};
