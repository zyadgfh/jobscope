#!/usr/bin/env node
'use strict';

/*
 * Post-deployment verification.
 *
 *   node scripts/verify-deployment.js https://your-project.vercel.app
 *   BASE=https://your-project.vercel.app npm run verify:deploy
 *   npm run verify:deploy -- --quick     # skip the batch loop
 *
 * Runs the same checks documented in docs/DEPLOYMENT.md against a live URL.
 * Hard failures (headers, auth, SSRF, contract) set exit code 1; run progress
 * that depends on the public internet is reported as a warning instead.
 */

const BASE = (process.argv.find(arg => /^https?:\/\//.test(arg)) || process.env.BASE || process.env.VERIFY_BASE || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const QUICK = process.argv.includes('--quick');
const MAX_BATCHES = 10;

let failures = 0;
let warnings = 0;

function pass(label, detail = '') {
  console.log(`  \u2713 ${label}${detail ? '  ' + detail : ''}`);
}

function fail(label, detail = '') {
  failures += 1;
  console.log(`  \u2717 ${label}${detail ? '  ' + detail : ''}`);
}

function warn(label, detail = '') {
  warnings += 1;
  console.log(`  ! ${label}${detail ? '  ' + detail : ''}`);
}

async function request(path, options = {}) {
  const response = await fetch(BASE + path, { redirect: 'manual', ...options });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, headers: response.headers, body };
}

async function main() {
  console.log(`\nJobScope deployment verification — ${BASE}\n`);
  const started = Date.now();

  // 1. Health
  const health = await request('/health');
  if (health.status !== 200) fail('GET /health', `status ${health.status}`);
  else if (health.body?.app !== 'jobscope') fail('GET /health payload', JSON.stringify(health.body).slice(0, 120));
  else pass('GET /health', `v${health.body.version} runtime=${health.body.runtime} controlPlane=${health.body.controlPlane}`);
  if (health.body && health.body.controlPlane === 'in-process-local') {
    warn('the API uses the in-process control plane', 'RESEARCH_CONTROL_URL is not set on the deployment');
  }

  // 2. Static app + security headers
  const home = await request('/');
  if (home.status !== 200) fail('GET /', `status ${home.status}`);
  else {
    const csp = home.headers.get('content-security-policy') || '';
    const checks = [
      [/default-src 'self'/.test(csp), 'CSP default-src'],
      [home.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options'],
      [home.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options'],
      [Boolean(home.headers.get('strict-transport-security')), 'Strict-Transport-Security'],
      [home.headers.get('referrer-policy') === 'strict-origin-when-cross-origin', 'Referrer-Policy']
    ];
    const missing = checks.filter(([ok]) => !ok).map(([, name]) => name);
    if (missing.length) fail('security headers', 'missing: ' + missing.join(', '));
    else pass('security headers', 'CSP + 4 headers');
    if (!/JobScope/.test(String(home.body))) warn('GET / did not contain the app markup');
  }

  // 3. API responses are not cacheable
  const apiHealth = await request('/api/health');
  if (apiHealth.status !== 200) fail('GET /api/health', `status ${apiHealth.status}`);
  else if ((apiHealth.headers.get('cache-control') || '') !== 'no-store') fail('GET /api/health cache-control', apiHealth.headers.get('cache-control') || '(none)');
  else pass('GET /api/health', 'cache-control: no-store');

  // 4. Protected routes reject anonymous callers
  const anonymousRead = await request('/api/research/runs/not-a-real-run');
  if (anonymousRead.status !== 401) fail('anonymous run read', `expected 401, saw ${anonymousRead.status}`);
  else pass('anonymous run read', '401 UNAUTHORIZED');
  const anonymousExecute = await request('/api/research/runs/execute/not-a-real-run', { method: 'POST' });
  if (anonymousExecute.status !== 401) fail('anonymous execute', `expected 401, saw ${anonymousExecute.status}`);
  else pass('anonymous execute', '401 UNAUTHORIZED');
  const anonymousFetch = await request('/api/research/sources/fetch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://wuzzuf.net/' })
  });
  if (anonymousFetch.status !== 401) fail('anonymous source fetch', `expected 401, saw ${anonymousFetch.status}`);
  else pass('anonymous source fetch', '401 UNAUTHORIZED');

  // 5. Create a run
  const created = await request('/api/research/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal: 'Deployment verification run', location: 'Alexandria', domain: 'jobs', depth: 'auto' })
  });
  if (created.status !== 201) {
    fail('POST /api/research/runs', `${created.status} ${JSON.stringify(created.body).slice(0, 160)}`);
    return summary(started);
  }
  const token = created.body?.accessToken;
  const runId = created.body?.run?.id;
  pass('POST /api/research/runs', `run ${runId}`);
  const budget = created.body?.run?.plan?.execution?.searchBudgetMs;
  if (!token || !runId) fail('create payload', 'no run id or access token');
  if (!(budget > 0 && budget <= 30000)) fail('plan execution budget', String(budget));
  else pass('plan batch budget', `${budget} ms`);
  const auth = { authorization: 'Bearer ' + token };

  // 6. SSRF guard needs a valid token
  const ssrf = await request('/api/research/sources/fetch', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'http://127.0.0.1/' })
  });
  if (ssrf.body?.error !== 'SSRF_BLOCKED') fail('SSRF guard', `${ssrf.status} ${JSON.stringify(ssrf.body).slice(0, 120)}`);
  else pass('SSRF guard', 'SSRF_BLOCKED for http://127.0.0.1/');

  // 7. Read the run back
  const read = await request(`/api/research/runs/${runId}`, { headers: auth });
  if (read.status !== 200 || read.body?.run?.id !== runId) fail('GET /api/research/runs/:id', `${read.status}`);
  else pass('GET /api/research/runs/:id', `state ${read.body.run.state}`);

  // 8. Drive the batch loop
  let state = read.body?.run?.state;
  let batches = 0;
  if (!QUICK && token) {
    for (let index = 0; index < MAX_BATCHES; index++) {
      const batch = await request(`/api/research/runs/execute/${runId}`, { method: 'POST', headers: auth });
      batches += 1;
      if (batch.status !== 200) {
        fail('POST /api/research/runs/execute/:id', `${batch.status} ${JSON.stringify(batch.body).slice(0, 160)}`);
        break;
      }
      state = batch.body?.run?.state || state;
      if (batch.body?.continue === false) break;
    }
    if (state === 'completed') pass('batch loop', `completed in ${batches} batches`);
    else warn('batch loop', `state ${state} after ${batches} batches (providers may be unreachable from the deployment)`);
  }

  // 9. Export
  const exported = await request(`/api/research/runs/${runId}/export`, { headers: auth });
  if (exported.status !== 200) fail('GET /api/research/runs/:id/export', `${exported.status}`);
  else if (!exported.body?.exportVersion) fail('export payload', 'no exportVersion');
  else pass('GET /api/research/runs/:id/export', `exportVersion ${exported.body.exportVersion}, report ${exported.body.run?.report?.version}`);

  return summary(started);
}

function summary(started) {
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${failures ? 'FAILED' : 'OK'} — ${failures} failure(s), ${warnings} warning(s) in ${seconds}s\n`);
  if (failures) {
    console.log('Check docs/DEPLOYMENT.md ("استكشاف الأخطاء") for the matching cause and fix.\n');
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(`\n  \u2717 verification crashed: ${error.message}`);
  console.error(`    Is ${BASE} reachable and serving the API?\n`);
  process.exitCode = 1;
});
