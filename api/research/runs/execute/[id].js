// Canonical batch endpoint on Vercel: POST /api/research/runs/execute/:id
const { executeRun } = require('../../../../src/api/execute-core');

module.exports = async function handler(req, res) {
  return executeRun(req, res);
};
