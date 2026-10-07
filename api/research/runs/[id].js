const research = require('../../../src/infrastructure/vercel-research');

module.exports = async function handler(req, res) {
  const id = req.query.id;
  try {
    if (req.method === 'GET') {
      const run = research.get(id);
      return run ? res.status(200).json(run) : res.status(404).json({ error: 'NOT_FOUND' });
    }
    if (req.method === 'POST') {
      const action = req.query.action;
      if (!['pause','resume','cancel'].includes(action)) return res.status(400).json({ error: 'INVALID_ACTION' });
      const run = research[action](id);
      return run ? res.status(200).json(run) : res.status(404).json({ error: 'NOT_FOUND' });
    }
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    const status = error.code === 'INVALID_STATE_TRANSITION' ? 409 : 400;
    return res.status(status).json({ error: error.code || 'BAD_REQUEST', message: error.message });
  }
};
