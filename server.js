const http = require('http');
const fs = require('fs');
const path = require('path');
const port = process.env.PORT || 3000;
const root = __dirname;
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
const server = http.createServer((req,res)=>{
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/health') { res.writeHead(200, {'Content-Type':'application/json'}); return res.end(JSON.stringify({ok:true,app:'jobscope'})); }
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(root, requested);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, {'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache'});
  fs.createReadStream(file).pipe(res);
});
server.listen(port,'0.0.0.0',()=>console.log(`JobScope listening on 0.0.0.0:${port}`));
