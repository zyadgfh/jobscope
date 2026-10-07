const http = require('http');
const fs = require('fs');
const path = require('path');
const { InMemoryResearchRunStore } = require('./src/infrastructure/research-store');
const { ResearchService } = require('./src/application/research-service');
const { registerResearchRoutes } = require('./src/api/research-routes');

const port = Number(process.env.PORT || 3000);
const root = __dirname;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const store = new InMemoryResearchRunStore();
const research = new ResearchService(store);

const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/api/research/')) return;
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer'
    });
    return res.end(JSON.stringify({ ok: true, app: 'jobscope', version: '0.2.0' }));
  }

  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.normalize(path.join(root, requested));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }

  res.writeHead(200, {
    'content-type': mime[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin'
  });
  fs.createReadStream(file).pipe(res);
});

registerResearchRoutes(server, research);

server.listen(port, '0.0.0.0', () => {
  console.log(`JobScope listening on 0.0.0.0:${port}`);
});
