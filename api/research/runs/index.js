const { call } = require('../../../src/infrastructure/research-control-client');
const { buildQueryPlan, buildExecution } = require('../../../src/domain/research/query-planner');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  const body = req.body || {};
  try {
    const domain = body.domain === 'general' ? 'general' : 'jobs';
    const plan = buildQueryPlan({ goal: body.goal, location: body.location || '', domain });
    plan.execution = buildExecution({ depth: body.depth, domain });
    const result = await call({
      op: 'create',
      goal: body.goal,
      mode: body.depth === 'deep' ? 'quality' : (body.mode || 'balanced'),
      preferences: body.preferences || {},
      plan
    });
    res.setHeader('cache-control', 'no-store');
    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'BAD_REQUEST', message: error.message });
  }
};
