// Filesystem-routing alias: on Vercel POST /api/research/runs/execute resolves to
// this file (the run id travels in the token, not the path), so the batch loop has
// exactly one implementation.
const { executeRun } = require('../../../../src/api/execute-core');

module.exports = async function handler(req, res) {
  return executeRun(req, res);
};
