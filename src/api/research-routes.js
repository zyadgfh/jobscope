const { URL } = require('node:url');

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length > 256 * 1024) throw Object.assign(new Error('payload too large'), { code: 'PAYLOAD_TOO_LARGE' });
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error('invalid JSON'), { code: 'INVALID_JSON' }); }
}

function streamEvents(res, service, id) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });
  const run = service.get(id);
  if (!run) return res.end();
  res.write(`event: snapshot\ndata: ${JSON.stringify(run)}\n\n`);
  const unsubscribe = service.subscribe(id, event => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  res.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function registerResearchRoutes(server, service) {
  server.on('request', async (req, res) => {
    if (!req.url?.startsWith('/api/research/')) return;
    const url = new URL(req.url, 'http://localhost');

    try {
      if (req.method === 'POST' && url.pathname === '/api/research/runs') {
        const body = await readJson(req);
        const run = service.create({
          goal: body.goal,
          mode: body.mode || 'balanced',
          actorId: body.actorId || 'guest'
        });
        return json(res, 201, run);
      }

      const match = url.pathname.match(/^\/api\/research\/runs\/([^/]+)(?:\/(pause|resume|cancel|events))?$/);
      if (match) {
        const [, id, action] = match;
        if (req.method === 'GET' && action === 'events') return streamEvents(res, service, id);
        if (req.method === 'GET' && !action) {
          const run = service.get(id);
          return run ? json(res, 200, run) : json(res, 404, { error: 'NOT_FOUND' });
        }
        if (req.method === 'POST' && action) {
          const run = service[action](id);
          return run ? json(res, 200, run) : json(res, 404, { error: 'NOT_FOUND' });
        }
      }
      return json(res, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      const status = error.code === 'PAYLOAD_TOO_LARGE' ? 413 :
        error.code === 'INVALID_JSON' ? 400 :
        error.code === 'INVALID_STATE_TRANSITION' ? 409 : 400;
      return json(res, status, { error: error.code || 'BAD_REQUEST', message: error.message });
    }
  });
}

module.exports = { registerResearchRoutes };
