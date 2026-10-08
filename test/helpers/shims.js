'use strict';

// Minimal req/res shim so the deployed Vercel handlers can be exercised
// exactly as they run in production (or under server.js).
function createRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end(payload) {
      if (payload !== undefined) this.body = payload;
      return this;
    }
  };
  return res;
}

async function invoke(handler, { method = 'GET', url = '/', token, body = {}, headers = {} } = {}) {
  const res = createRes();
  const query = {};
  const queryStart = url.indexOf('?');
  if (queryStart >= 0) {
    for (const [key, value] of new URLSearchParams(url.slice(queryStart + 1))) query[key] = value;
  }
  const req = {
    method,
    url,
    query,
    body,
    headers: {
      ...headers,
      ...(token ? { authorization: 'Bearer ' + token } : {})
    }
  };
  await handler(req, res);
  return { status: res.statusCode, body: res.body, headers: res.headers };
}

module.exports = { invoke, createRes };
