'use strict';
const { localControlRequest } = require('./local-research-control');

const DEFAULT_CONTROL_URL = 'https://mtziqpyvgebthoynalbq.supabase.co/functions/v1/research-control';
const CONTROL_URL = String(process.env.RESEARCH_CONTROL_URL || DEFAULT_CONTROL_URL).replace(/\/+$/, '');
const isLocalControl = /^local$/i.test(CONTROL_URL) || process.env.JOBSCOPE_LOCAL_CONTROL === '1';
const TOKEN_PATTERN = /^[A-Za-z0-9_\-.]{16,300}$/;

function normalizeToken(token) {
  return String(token || '').replace(/^Bearer\s+/i, '').trim();
}

function isPlausibleToken(token) {
  return TOKEN_PATTERN.test(normalizeToken(token));
}

async function call(body, { token = '', timeoutMs = 12000 } = {}) {
  const clean = normalizeToken(token);
  if (isLocalControl) {
    const result = localControlRequest(body, clean);
    return result.payload;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(CONTROL_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(clean ? { authorization: 'Bearer ' + clean } : {})
      },
      redirect: 'error',
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    if (!response.ok) {
      throw Object.assign(new Error(data?.message || data?.error || 'Research control request failed'), {
        code: data?.error || 'CONTROL_REQUEST_FAILED',
        status: response.status
      });
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { call, CONTROL_URL, DEFAULT_CONTROL_URL, normalizeToken, isPlausibleToken, isLocalControl };
