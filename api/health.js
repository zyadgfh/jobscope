const { version } = require('../package.json');
const { isLocalControl, CONTROL_URL } = require('../src/infrastructure/research-control-client');

module.exports = function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  return res.status(200).json({
    ok: true,
    app: 'jobscope',
    version,
    time: new Date().toISOString(),
    runtime: 'vercel',
    controlPlane: isLocalControl ? 'in-process-local' : 'supabase-edge-function',
    controlPlaneHost: isLocalControl ? 'local' : new URL(CONTROL_URL).host,
    durableControlPlane: true
  });
};
