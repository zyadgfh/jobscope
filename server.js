'use strict';
// Local development runs the in-process control plane unless a real URL is set,
// so `npm start` exercises the full request lifecycle without cloud credentials.
if (!process.env.RESEARCH_CONTROL_URL) process.env.RESEARCH_CONTROL_URL = 'local';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { registerResearchRoutes } = require('./src/api/research-routes');
const { applySecurityHeaders } = require('./src/api/security-headers');
const { version } = require('./package.json');

const root = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

// Explicit allowlist instead of "serve the whole repository".
const STATIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/styles.css', 'styles.css'],
  ['/robots.txt', 'robots.txt'],
  ['/favicon.ico', 'favicon.ico']
]);
const STATIC_PREFIXES = ['/assets/', '/public/'];

function resolveStatic(pathname) {
  const mapped = STATIC_FILES.get(pathname);
  if (mapped) return path.join(root, mapped);
  const prefix = STATIC_PREFIXES.find(candidate => pathname.startsWith(candidate));
  if (!prefix) return null;
  const relative = decodeURIComponent(pathname.slice(1));
  const candidate = path.normalize(path.join(root, relative));
  const base = path.resolve(root, prefix.slice(1, -1)) + path.sep;
  if (!candidate.startsWith(base)) return null;
  return candidate;
}

function createServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health' || url.pathname.startsWith('/api/')) return;

    const file = resolveStatic(url.pathname);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }

    applySecurityHeaders(res);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    fs.createReadStream(file).pipe(res);
  });

  registerResearchRoutes(server);
  return server;
}

function start(port = Number(process.env.PORT || 3000)) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      const mode = process.env.RESEARCH_CONTROL_URL === 'local' ? 'in-process control plane' : process.env.RESEARCH_CONTROL_URL;
      console.log(`JobScope v${version} listening on 0.0.0.0:${server.address().port} (${mode})`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  start().catch(error => {
    console.error('JobScope failed to start:', error.message);
    process.exit(1);
  });
}

module.exports = { createServer, start, STATIC_FILES };
