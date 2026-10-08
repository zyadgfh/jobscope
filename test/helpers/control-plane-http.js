'use strict';

const http = require('node:http');
const { localControlRequest } = require('../../src/infrastructure/local-research-control');

/*
 * HTTP façade over the control-plane protocol. It lets the client's real
 * fetch/Bearer/error-mapping path be exercised without Supabase, and records the
 * raw Authorization header so token handling can be asserted at the wire level.
 */
function startControlPlane({ port = 0 } = {}) {
  const seenAuthorizations = [];
  const server = http.createServer(async (req, res) => {
    seenAuthorizations.push(String(req.headers.authorization || ''));
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'INVALID_JSON' }));
    }
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    try {
      const { status, payload } = localControlRequest(body, token);
      res.writeHead(status || 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch (error) {
      res.writeHead(error.status || 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error.code || 'BAD_REQUEST', message: error.message }));
    }
  });
  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => resolve({ server, seenAuthorizations, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

module.exports = { startControlPlane };
