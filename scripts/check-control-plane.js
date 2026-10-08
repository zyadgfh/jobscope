#!/usr/bin/env node
'use strict';

/*
 * Deployment readiness probe.
 *
 *   RESEARCH_CONTROL_URL=https://<project>.supabase.co/functions/v1/research-control npm run deploy:check
 *
 * It performs a real create -> read -> snapshot -> revoke round trip and verifies
 * that the deployed control plane already contains the 0.9 hardening
 * (run-scoped snapshots and the 1.3 run contract). Exit code 1 on a hard failure.
 */

const { call, CONTROL_URL, isLocalControl } = require('../src/infrastructure/research-control-client');
const { version } = require('../package.json');

const EXPECTED_RUN_VERSION = '1.3';
let warnings = 0;

function line(label, value) {
  console.log(`  ${label.padEnd(16)} ${value}`);
}

function networkError(message) {
  return /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|abort/i.test(String(message));
}

async function main() {
  console.log(`\nJobScope v${version} — control-plane readiness check\n`);
  const explicitUrl = Boolean(process.env.RESEARCH_CONTROL_URL);
  line('control plane', isLocalControl ? 'local (in-process)' : CONTROL_URL);
  line('source', explicitUrl || isLocalControl ? 'RESEARCH_CONTROL_URL' : 'built-in project default');
  if (isLocalControl) {
    console.log('\n  WARN  The in-process control plane is being probed, not the deployed one.');
    console.log('        Run with RESEARCH_CONTROL_URL=https://<project>.supabase.co/functions/v1/research-control');
    console.log('        to verify production (see .env.example and docs/DEPLOYMENT.md).\n');
    warnings += 1;
  }

  const created = await call({
    op: 'create',
    goal: 'JobScope deployment readiness probe',
    plan: { version: '1.3', tasks: [], execution: { maxExpansionRounds: 0, maxExpansionTasks: 1 } }
  });
  line('create', `ok (run ${created.run.id}, state ${created.run.state})`);

  const read = await call({ op: 'get' }, { token: created.accessToken });
  line('read', `ok (state ${read.run.state})`);

  const snapshot = await call({ op: 'snapshot' }, { token: created.accessToken });
  line('snapshot', `ok (documents ${snapshot.documents.length}, sources ${snapshot.sources.length}, evidence ${snapshot.evidence.length})`);

  if (read.run.version !== EXPECTED_RUN_VERSION) {
    console.log(`\n  WARN  The deployed control plane reports run version ${read.run.version}, expected ${EXPECTED_RUN_VERSION}.`);
    console.log('        Redeploy it: supabase functions deploy research-control --no-verify-jwt\n');
    warnings += 1;
  }
  if (snapshot.documents.length || snapshot.sources.length) {
    console.log('\n  WARN  A brand new run can already read documents/sources, so the deployed function');
    console.log('        (or its migration) predates run-scoped retrieval. Apply');
    console.log('        supabase/migrations/20261008120000_run_scoped_retrieval.sql and redeploy.\n');
    warnings += 1;
  }

  await call({ op: 'revoke' }, { token: created.accessToken });
  line('revoke', 'ok');

  let revoked = false;
  try {
    await call({ op: 'get' }, { token: created.accessToken });
  } catch (error) {
    revoked = error.code === 'UNAUTHORIZED';
  }
  line('revoke check', revoked ? 'ok (token is dead)' : 'FAILED — a revoked token still works');
  if (!revoked) process.exitCode = 1;

  if (!process.exitCode) {
    console.log(warnings
      ? `\nControl plane reachable with ${warnings} warning(s) — see above.\n`
      : '\nControl plane is ready for production use.\n');
  }
}

main().catch(error => {
  const unreachable = networkError(error.message);
  console.error(`\n  FAIL  ${unreachable ? 'NETWORK_UNREACHABLE' : (error.code || 'CHECK_FAILED')}  ${error.message}`);
  if (unreachable) {
    console.error(`        The runtime could not reach ${CONTROL_URL}.`);
    console.error('        Verify the URL, that the function is deployed, and that the network allows outbound HTTPS.');
  }
  if (error.status === 401) {
    console.error('        The function answered 401 — it likely requires a Supabase JWT. Deploy it with --no-verify-jwt.');
  }
  process.exitCode = 1;
});
