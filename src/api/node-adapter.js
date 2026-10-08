'use strict';

const MAX_PAYLOAD_BYTES = 512 * 1024;

// Minimal adapter that lets the Vercel-style handlers also run under the plain
// node http server, so `npm start` and production share one implementation.
function createNodeHandler(handler) {
  return async function handle(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    let raw = '';
    let tooLarge = false;
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_PAYLOAD_BYTES) {
        tooLarge = true;
        break;
      }
    }
    if (tooLarge) {
      res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'PAYLOAD_TOO_LARGE' }));
    }

    let body = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'INVALID_JSON' }));
      }
    }

    const shim = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) {
        this.headers[String(key).toLowerCase()] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.setHeader('content-type', 'application/json; charset=utf-8');
        res.writeHead(this.statusCode, this.headers);
        res.end(JSON.stringify(payload));
        return this;
      }
    };

    req.body = body;
    req.query = Object.fromEntries(url.searchParams);

    try {
      await handler(req, shim);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(error?.status || 500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error?.code || 'INTERNAL_ERROR', message: error?.message }));
      }
    }
  };
}

module.exports = { createNodeHandler, MAX_PAYLOAD_BYTES };
