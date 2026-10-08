'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  assertSafeUrl,
  fetchPublicSource,
  httpGetPinned,
  isAllowedContentType,
  isPrivateIp,
  isIpLiteral,
  parseIpv6
} = require('../src/application/source-fetcher');

function listen(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function expectCode(promise, code) {
  try {
    await promise;
    assert.fail(`expected rejection with ${code}`);
  } catch (error) {
    assert.equal(error.code, code, `expected ${code}, received ${error.code || error.message}`);
  }
}

test('private, wildcard and metadata addresses are blocked', async () => {
  const blocked = [
    'http://0/', 'http://0.0.0.0/', 'http://127.0.0.1/', 'http://127.1/', 'http://0177.0.0.1/',
    'http://2130706433/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:0:0]/',
    'http://[0:0:0:0:0:0:0:1]/', 'http://169.254.169.254/', 'http://metadata.google.internal/',
    'http://10.1.2.3/', 'http://192.168.1.1/', 'http://172.20.5.5/', 'http://localhost/',
    'http://service.local/', 'http://host.internal/', 'http://100.64.0.1/', 'http://[fc00::1]/',
    'http://[fe80::1]/', 'http://[2002:7f00:1::]/'
  ];
  for (const url of blocked) {
    await expectCode(assertSafeUrl(url, { resolveHost: async () => [{ address: '8.8.8.8', family: 4 }] }), 'SSRF_BLOCKED');
  }
});

test('unsupported protocols and embedded credentials are rejected', async () => {
  await expectCode(assertSafeUrl('ftp://example.com/'), 'UNSUPPORTED_PROTOCOL');
  await expectCode(assertSafeUrl('file:///etc/passwd'), 'UNSUPPORTED_PROTOCOL');
  await expectCode(assertSafeUrl('http://user:secret@example.com/'), 'UNSAFE_URL');
  await expectCode(assertSafeUrl('not-a-url'), 'INVALID_URL');
  await expectCode(assertSafeUrl('http://'), 'INVALID_URL');
});

test('a hostname that resolves to a private address is blocked (rebinding)', async () => {
  await expectCode(assertSafeUrl('http://rebind.example/', { resolveHost: async () => [{ address: '10.0.0.5', family: 4 }] }), 'SSRF_BLOCKED');
  await expectCode(assertSafeUrl('http://rebind.example/', { resolveHost: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] }), 'SSRF_BLOCKED');
  await expectCode(assertSafeUrl('http://nx.example/', { resolveHost: async () => { throw new Error('ENOTFOUND'); } }), 'HOST_RESOLUTION_FAILED');
});

test('an allowed hostname returns the validated addresses for pinning', async () => {
  const result = await assertSafeUrl('https://wuzzuf.net/jobs', { resolveHost: async () => [{ address: '93.184.216.34', family: 4 }] });
  assert.equal(result.host, 'wuzzuf.net');
  assert.deepEqual(result.addresses, [{ address: '93.184.216.34', family: 4 }]);
});

test('the loopback server is never reached through a wildcard host', async () => {
  let hits = 0;
  const { server, port } = await listen((req, res) => {
    hits += 1;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html>internal</html>');
  });
  try {
    for (const target of [`http://0:${port}/`, `http://0.0.0.0:${port}/`, `http://127.0.0.1:${port}/`, `http://[::ffff:127.0.0.1]:${port}/`]) {
      await expectCode(fetchPublicSource(target, { allowUnregistered: true }), 'SSRF_BLOCKED');
    }
    assert.equal(hits, 0, 'no request may reach the loopback service');
  } finally {
    server.close();
  }
});

test('unregistered domains are rejected unless explicitly allowed', async () => {
  await expectCode(fetchPublicSource('https://evil.example/', { resolveHost: async () => [{ address: '93.184.216.34', family: 4 }] }), 'SOURCE_NOT_REGISTERED');
});

test('content types outside text/html and text/plain are refused', () => {
  assert.equal(isAllowedContentType('text/html; charset=utf-8'), true);
  assert.equal(isAllowedContentType('text/plain'), true);
  assert.equal(isAllowedContentType('application/json'), false);
  assert.equal(isAllowedContentType('image/png'), false);
  assert.equal(isAllowedContentType(''), false);
});

test('the pinned transport blocks redirects, oversized and slow responses', async () => {
  const redirect = await listen((req, res) => {
    res.writeHead(302, { location: 'http://169.254.169.254/' });
    res.end();
  });
  try {
    await expectCode(
      httpGetPinned(new URL(`http://127.0.0.1:${redirect.port}/`), { address: '127.0.0.1', family: 4, timeoutMs: 2000, maxBytes: 1000 }),
      'REDIRECT_BLOCKED'
    );
  } finally {
    redirect.server.close();
  }

  const huge = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'content-length': '999999' });
    res.end('x');
  });
  try {
    await expectCode(
      httpGetPinned(new URL(`http://127.0.0.1:${huge.port}/`), { address: '127.0.0.1', family: 4, timeoutMs: 2000, maxBytes: 1000 }),
      'RESPONSE_TOO_LARGE'
    );
  } finally {
    huge.server.close();
  }

  const streamed = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    const chunk = 'y'.repeat(1000);
    let sent = 0;
    const timer = setInterval(() => {
      res.write(chunk);
      if (++sent > 5) {
        clearInterval(timer);
        res.end();
      }
    }, 5);
  });
  try {
    await expectCode(
      httpGetPinned(new URL(`http://127.0.0.1:${streamed.port}/`), { address: '127.0.0.1', family: 4, timeoutMs: 2000, maxBytes: 1500 }),
      'RESPONSE_TOO_LARGE'
    );
  } finally {
    streamed.server.close();
  }

  const slow = await listen(() => { /* never responds */ });
  try {
    await expectCode(
      httpGetPinned(new URL(`http://127.0.0.1:${slow.port}/`), { address: '127.0.0.1', family: 4, timeoutMs: 200, maxBytes: 1000 }),
      'SOURCE_TIMEOUT'
    );
  } finally {
    slow.server.close();
  }
});

test('the pinned transport returns a bounded body on success', async () => {
  const { server, port } = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><title>ok</title></html>');
  });
  try {
    const response = await httpGetPinned(new URL(`http://127.0.0.1:${port}/`), { address: '127.0.0.1', family: 4, timeoutMs: 2000, maxBytes: 1000 });
    assert.equal(response.status, 200);
    assert.match(response.body, /<title>ok<\/title>/);
  } finally {
    server.close();
  }
});

test('address helpers classify notation variants', () => {
  assert.equal(isPrivateIp('0.0.0.0'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(isPrivateIp('::ffff:7f00:1'), true);
  assert.equal(isPrivateIp('::ffff:0808:0808'), false);
  assert.equal(isPrivateIp('2001:db8::1'), true);
  assert.equal(isPrivateIp('2606:4700::1111'), false);
  assert.equal(isIpLiteral('2130706433'), true);
  assert.equal(isIpLiteral('example.com'), false);
  assert.deepEqual(parseIpv6('::ffff:127.0.0.1'), [0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001]);
  assert.equal(parseIpv6('not-an-address'), null);
});
