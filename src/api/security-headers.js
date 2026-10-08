'use strict';

// Kept in sync with vercel.json so local and production responses match.
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join('; '),
  'strict-transport-security': 'max-age=31536000; includeSubDomains'
};

function applySecurityHeaders(res) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
}

module.exports = { SECURITY_HEADERS, applySecurityHeaders };
