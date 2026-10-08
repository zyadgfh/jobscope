'use strict';
const { createNodeHandler } = require('./node-adapter');
const { applySecurityHeaders } = require('./security-headers');

// The very same handlers Vercel deploys, so `npm start` and production cannot drift.
const createRun = require('../../api/research/runs/index.js');
const runById = require('../../api/research/runs/[id].js');
const executeRun = require('../../api/research/runs/execute/[id].js');
const runEvidence = require('../../api/research/runs/[id]/evidence.js');
const exportRun = require('../../api/research/runs/[id]/export.js');
const fetchSource = require('../../api/research/sources/fetch.js');
const health = require('../../api/health.js');

// URL shapes mirror the deployed file layout exactly:
//   api/research/runs/index.js          -> POST /api/research/runs
//   api/research/runs/execute/[id].js   -> POST /api/research/runs/execute/:id
//   api/research/runs/[id].js           -> GET|POST /api/research/runs/:id
//   api/research/runs/[id]/evidence.js  -> POST /api/research/runs/:id/evidence
//   api/research/runs/[id]/export.js    -> GET  /api/research/runs/:id/export
//   api/research/sources/fetch.js       -> POST /api/research/sources/fetch
const ROUTES = [
  { method: 'GET', pattern: /^\/(api\/)?health$/, handler: health, url: '/api/health' },
  { method: 'POST', pattern: /^\/api\/research\/runs$/, handler: createRun, url: '/api/research/runs' },
  { method: 'POST', pattern: /^\/api\/research\/runs\/execute\/[^/]+$/, handler: executeRun, url: '/api/research/runs/execute/:id' },
  { method: 'POST', pattern: /^\/api\/research\/runs\/[^/]+\/evidence$/, handler: runEvidence, url: '/api/research/runs/:id/evidence' },
  { method: 'GET', pattern: /^\/api\/research\/runs\/[^/]+\/export$/, handler: exportRun, url: '/api/research/runs/:id/export' },
  { method: 'GET', pattern: /^\/api\/research\/runs\/[^/]+$/, handler: runById, url: '/api/research/runs/:id' },
  { method: 'POST', pattern: /^\/api\/research\/runs\/[^/]+$/, handler: runById, url: '/api/research/runs/:id' },
  { method: 'POST', pattern: /^\/api\/research\/sources\/fetch$/, handler: fetchSource, url: '/api/research/sources/fetch' }
];

function isApiPath(pathname) {
  return pathname === '/health' || pathname.startsWith('/api/');
}

function findRoute(method, pathname) {
  return ROUTES.find(route => route.method === method && route.pattern.test(pathname)) || null;
}

function routeFor(pathname, method = 'GET') {
  return findRoute(method, pathname);
}

function registerResearchRoutes(server) {
  const handlers = new Map();
  for (const route of ROUTES) {
    if (!handlers.has(route.handler)) handlers.set(route.handler, createNodeHandler(route.handler));
  }

  server.on('request', async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (!isApiPath(url.pathname)) return;

    applySecurityHeaders(res);
    res.setHeader('cache-control', 'no-store');

    const route = findRoute(req.method, url.pathname);
    if (!route) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'NOT_FOUND' }));
    }
    return handlers.get(route.handler)(req, res);
  });
}

module.exports = { registerResearchRoutes, findRoute, routeFor, ROUTES, isApiPath };
