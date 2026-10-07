const research = require('../../../src/infrastructure/vercel-research');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  const body = req.body || {};
  try {
    const run = research.create({
      goal: body.goal,
      mode: body.mode || 'balanced',
      actorId: body.actorId || 'guest'
    });
    return res.status(201).json(run);
  } catch (error) {
    return res.status(400).json({ error: error.code || 'BAD_REQUEST', message: error.message });
  }
};
