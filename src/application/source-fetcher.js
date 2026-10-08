'use strict';
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const crypto = require('node:crypto');
const { findSource, UNREGISTERED_SOURCE } = require('../domain/research/source-registry');
const { createSourceDocument } = require('../domain/research/source-document');

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 1000000;
const USER_AGENT = 'JobScopeResearch/0.9 (+public-research-client)';
const ALLOWED_CONTENT_TYPE = /text\/(html|plain)/i;

function isAllowedContentType(contentType) {
  return ALLOWED_CONTENT_TYPE.test(String(contentType || ''));
}

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

/* ------------------------------------------------------------------ *
 * Address classification
 * ------------------------------------------------------------------ */

// Ranges that must never be reachable from untrusted research content.
const BLOCKED_V4_RANGES = [
  ['0.0.0.0', 8],        // "this network": 0.0.0.0 connects to loopback on Linux
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],    // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],   // link-local, includes cloud metadata endpoints
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // TEST-NET-1
  ['192.88.99.0', 24],   // 6to4 relay anycast
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // TEST-NET-2
  ['203.0.113.0', 24],   // TEST-NET-3
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4]       // reserved, includes 255.255.255.255
];

function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8) | n;
  }
  return value >>> 0;
}

function isBlockedV4(ip) {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return BLOCKED_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(base) & mask);
  });
}

// Replaces a trailing dotted-quad with its two hexadecimal groups so that
// "::ffff:127.0.0.1" becomes "::ffff:7f00:1" before parsing.
function normalizeEmbeddedV4(text) {
  if (!text.includes('.')) return text;
  const idx = text.lastIndexOf(':');
  if (idx < 0) return text;
  const octets = text.slice(idx + 1).split('.');
  if (octets.length !== 4) return text;
  const nums = octets.map(x => (/^\d{1,3}$/.test(x) ? Number(x) : NaN));
  if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return text;
  const hex = ((nums[0] << 8) | nums[1]).toString(16) + ':' + ((nums[2] << 8) | nums[3]).toString(16);
  return text.slice(0, idx + 1) + hex;
}

function parseIpv6(raw) {
  let text = String(raw || '').toLowerCase().trim();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  if (!text.includes(':')) return null;
  text = normalizeEmbeddedV4(text);
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const toGroups = part => (part ? part.split(':') : []);
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  const groups = [...head, ...tail];
  if (groups.some(g => g !== '' && !/^[0-9a-f]{1,4}$/.test(g))) return null;
  if (halves.length === 2) {
    const missing = 8 - groups.length;
    if (missing < 1) return null;
    return [...head, ...Array(missing).fill('0'), ...tail].map(g => parseInt(g || '0', 16));
  }
  if (groups.length !== 8) return null;
  return groups.map(g => parseInt(g || '0', 16));
}

function groupsToV4(high, low) {
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

function isBlockedV6(groups) {
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::/96) forms inherit the
  // verdict of the embedded address, so 0.0.0.0/8 and 127.0.0.0/8 cannot sneak in.
  if (groups.slice(0, 5).every(x => x === 0) && groups[5] === 0xffff) return isBlockedV4(groupsToV4(groups[6], groups[7]));
  if (groups.slice(0, 6).every(x => x === 0)) return isBlockedV4(groupsToV4(groups[6], groups[7]));
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every(x => x === 0)) {
    return isBlockedV4(groupsToV4(groups[6], groups[7])); // NAT64
  }
  if (groups[0] === 0x2002) return isBlockedV4(groupsToV4(groups[1], groups[2])); // 6to4
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((groups[0] & 0xff00) === 0xff00) return true; // multicast ff00::/8
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true; // documentation 2001:db8::/32
  return false;
}

function isPrivateIp(ip) {
  const value = String(ip || '').trim().replace(/^\[|\]$/g, '');
  if (!value) return false;
  if (value.includes(':')) {
    const groups = parseIpv6(value);
    return groups ? isBlockedV6(groups) : true; // unparseable IPv6 is treated as unsafe
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return isBlockedV4(value);
  return false;
}

function isIpLiteral(host) {
  const value = String(host || '').replace(/^\[|\]$/g, '');
  if (!value) return false;
  if (value.includes(':')) return parseIpv6(value) !== null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return ipv4ToInt(value) !== null;
  // Decimal, octal and hexadecimal IPv4 notations are normalised by the WHATWG
  // URL parser, so a fully numeric label is still suspicious here.
  return /^(0x[0-9a-f]+|\d+)$/i.test(value);
}

/* ------------------------------------------------------------------ *
 * Policy
 * ------------------------------------------------------------------ */

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

async function defaultResolveHost(hostname) {
  const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return records.map(r => ({ address: r.address, family: r.family }));
}

async function assertSafeUrl(raw, { resolveHost = defaultResolveHost } = {}) {
  let url;
  try {
    url = new URL(String(raw || ''));
  } catch {
    throw fail('INVALID_URL', 'url is not parseable');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw fail('UNSUPPORTED_PROTOCOL', 'unsupported protocol');
  if (url.username || url.password) throw fail('UNSAFE_URL', 'credentials in URL are not allowed');

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) throw fail('INVALID_URL', 'url has no hostname');
  if (host === 'localhost' || BLOCKED_HOST_SUFFIXES.some(s => host.endsWith(s))) {
    throw fail('SSRF_BLOCKED', 'private network target blocked');
  }
  if (isIpLiteral(host)) throw fail('SSRF_BLOCKED', 'IP literal targets are not allowed');
  if (isPrivateIp(host)) throw fail('SSRF_BLOCKED', 'private network target blocked');

  let addresses;
  try {
    addresses = await resolveHost(host);
  } catch {
    throw fail('HOST_RESOLUTION_FAILED', 'hostname resolution failed');
  }
  if (!Array.isArray(addresses) || !addresses.length) throw fail('HOST_RESOLUTION_FAILED', 'hostname resolution failed');
  if (addresses.some(a => isPrivateIp(a.address))) {
    throw fail('SSRF_BLOCKED', 'hostname resolves to private network');
  }
  return { url, host, addresses };
}

/* ------------------------------------------------------------------ *
 * Transport (DNS-pinned: the validated address is the only one used)
 * ------------------------------------------------------------------ */

function httpGetPinned(target, { address, family = 4, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, headers = {}, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = target.protocol === 'https:';
    const lib = isHttps ? https : http;
    let settled = false;
    const timer = setTimeout(() => {
      request.destroy(fail('SOURCE_TIMEOUT', 'source request timed out'));
    }, timeoutMs + 500);
    const done = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const request = lib.request({
      protocol: target.protocol,
      hostname: target.hostname,
      servername: isHttps ? target.hostname : undefined,
      port: target.port ? Number(target.port) : (isHttps ? 443 : 80),
      path: (target.pathname || '/') + (target.search || ''),
      method,
      headers,
      agent: false,
      // Pin the connection to the address that passed policy validation.
      lookup: (hostname, options, callback) => {
        if (options && options.all) return callback(null, [{ address, family }]);
        return callback(null, address, family);
      }
    }, response => {
      const status = Number(response.statusCode || 0);
      if (status >= 300 && status < 400) {
        response.resume();
        return done(fail('REDIRECT_BLOCKED', 'redirects are not followed'));
      }
      if (status < 200 || status >= 300) {
        response.resume();
        return done(Object.assign(fail('SOURCE_HTTP_ERROR', 'source returned HTTP ' + status), { status }));
      }
      const declared = Number(response.headers['content-length'] || 0);
      if (declared && declared > maxBytes) {
        response.destroy();
        return done(fail('RESPONSE_TOO_LARGE', 'response body exceeds size limit'));
      }
      const chunks = [];
      let total = 0;
      response.on('data', chunk => {
        total += chunk.length;
        if (total > maxBytes) {
          response.destroy();
          return done(fail('RESPONSE_TOO_LARGE', 'response body exceeds size limit'));
        }
        chunks.push(chunk);
      });
      response.on('end', () => done(null, {
        status,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
      response.on('error', error => done(error));
    });
    request.setTimeout(timeoutMs, () => request.destroy(fail('SOURCE_TIMEOUT', 'source request timed out')));
    request.on('error', error => done(error.code ? error : fail('SOURCE_REQUEST_FAILED', String(error.message || error))));
    request.end();
  });
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

async function fetchPublicSource(raw, { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, allowUnregistered = false, resolveHost, headers = {} } = {}) {
  const target = await assertSafeUrl(raw, { resolveHost });
  const source = findSource(target.url.toString()) || (allowUnregistered ? UNREGISTERED_SOURCE : null);
  if (!source) throw fail('SOURCE_NOT_REGISTERED', 'source domain is not registered');

  const [first] = target.addresses;
  const response = await httpGetPinned(target.url, {
    address: first.address,
    family: first.family,
    timeoutMs,
    maxBytes,
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,text/plain;q=0.9',
      'accept-language': 'ar,en;q=0.8',
      ...headers
    }
  });

  const contentType = String(response.headers['content-type'] || '');
  if (!isAllowedContentType(contentType)) throw fail('CONTENT_TYPE_BLOCKED', 'unsupported content type');

  const content = response.body;
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');
  return createSourceDocument({
    sourceId: source.id,
    url: target.url.toString(),
    contentType,
    title: target.url.hostname,
    content,
    contentHash
  });
}

module.exports = {
  fetchPublicSource,
  assertSafeUrl,
  isAllowedContentType,
  httpGetPinned,
  isPrivateIp,
  isIpLiteral,
  parseIpv6,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_BYTES
};
