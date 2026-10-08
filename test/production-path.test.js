'use strict';
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// The production path talks to the control plane over HTTP. This suite points the
// client at a real HTTP endpoint so fetch headers, status mapping and the batch
// loop are exercised exactly as they run on Vercel.
process.env.JOBSCOPE_LOCAL_STORE = path.join(os.tmpdir(), `jobscope-prod-path-${process.pid}.json`);
fs.rmSync(process.env.JOBSCOPE_LOCAL_STORE, { force: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const { startControlPlane } = require('./helpers/control-plane-http');
const { canonicalKey } = require('../src/domain/research/entity-resolution');

const ready = (async () => {
  const plane = await startControlPlane();
  process.env.RESEARCH_CONTROL_URL = plane.url;     // must be set before the client is required
  const client = require('../src/infrastructure/research-control-client');
  const { executeBatch, batchBudget } = require('../src/application/research-executor');
  const { buildQueryPlan, buildExecution } = require('../src/domain/research/query-planner');
  const createRun = require('../api/research/runs/index.js');
  const runById = require('../api/research/runs/[id].js');
  const { invoke } = require('./helpers/shims');
  return { plane, client, executeBatch, batchBudget, buildQueryPlan, buildExecution, createRun, runById, invoke };
})();

// The listener must be closed or the test process never exits (an orphan listener
// hangs `node --test`).
test.after(async () => {
  const { plane } = await ready;
  await new Promise(resolve => plane.server.close(resolve));
});

function jobFor(sourceId) {
  const base = {
    title: 'Data Entry Specialist',
    company: 'Acme Ltd',
    location: 'Alexandria',
    salary: { currency: 'EGP', frequency: 'month', amount: { min: 7000, max: 9000 } },
    description: 'Excel data entry with training',
    requirements: ['Excel'],
    employment: { type: 'FULL_TIME', datePosted: new Date().toISOString(), workMode: 'onsite' },
    url: `https://${sourceId}.example/jobs/1`,
    sourceId,
    confidence: .9
  };
  return { ...base, canonicalKey: canonicalKey(base) };
}

test('the client reaches a remote control plane over HTTP with a single Bearer prefix', async () => {
  const { plane, client } = await ready;
  assert.equal(client.isLocalControl, false, 'a remote URL must use the HTTP transport');
  const created = await client.call({ op: 'create', goal: 'HTTP transport check', plan: { version: '1.3', tasks: [] } });
  assert.ok(created.accessToken);
  await client.call({ op: 'get' }, { token: created.accessToken });

  const authHeaders = plane.seenAuthorizations.filter(header => header.includes('Bearer'));
  for (const header of authHeaders) {
    assert.match(header, /^Bearer [A-Za-z0-9_\-.]{16,}$/, `malformed authorization header on the wire: ${header}`);
    assert.equal((header.match(/Bearer/g) || []).length, 1, 'the Bearer prefix must appear exactly once');
    assert.ok(!header.includes('Bearer Bearer'), 'the double-Bearer regression must not come back');
  }
});

test('a full run completes against the HTTP control plane', async () => {
  const { executeBatch, buildQueryPlan, buildExecution, createRun, invoke } = await ready;
  const created = await invoke(createRun, {
    method: 'POST',
    url: '/api/research/runs',
    body: { goal: 'Data Entry', location: 'Alexandria', domain: 'jobs', depth: 'auto', preferences: { minSalary: 7000 } }
  });
  assert.equal(created.status, 201);
  const { accessToken, run } = created.body;
  assert.ok(run.plan.execution.searchBudgetMs >= 1000, 'the plan carries a per-batch search budget');

  const providers = {
    searchJobs: async (query, options) => {
      assert.ok(options.timeBudgetMs > 0, 'each provider call is bounded by the batch budget');
      assert.ok(options.timeBudgetMs <= 30000);
      const providerId = options.sourceIds[0];
      return {
        documents: [],
        sources: [{ sourceKey: providerId, canonical_url: `https://${providerId}.net`, source_type: 'job_board', reliability: .7, metadata: {} }],
        jobs: [jobFor(providerId)],
        evidence: [{ claim: `listing on ${providerId}`, sourceId: providerId, status: 'reported', confidence: .8, provenance: { url: `https://${providerId}.net/jobs/1` } }]
      };
    },
    searchWeb: async () => ({ documents: [], sources: [], jobs: [], evidence: [], links: [] })
  };

  let snapshot = null;
  for (let index = 0; index < 20; index++) {
    snapshot = (await executeBatch(accessToken, providers)).payload.run;
    if (['completed', 'failed', 'cancelled'].includes(snapshot.state)) break;
  }
  assert.equal(snapshot.state, 'completed');
  assert.equal(snapshot.report.version, '1.3');
  assert.ok(snapshot.report.stopping.reason, 'the stop reason survives the HTTP round trip');
  assert.ok(snapshot.opportunities.length >= 1);
});

test('control-plane errors keep their status and code over HTTP', async () => {
  const { client } = await ready;
  await assert.rejects(
    () => client.call({ op: 'get' }, { token: 'definitely-not-a-real-token-000' }),
    error => error.status === 401 && error.code === 'UNAUTHORIZED'
  );
  await assert.rejects(
    () => client.call({ op: 'nonsense-operation' }, { token: 'definitely-not-a-real-token-000' }),
    error => error.status === 401
  );
  const created = await client.call({ op: 'create', goal: 'Error mapping', plan: { version: '1.3', tasks: [] } });
  await assert.rejects(
    () => client.call({ op: 'nonsense-operation' }, { token: created.accessToken }),
    error => error.status === 400 && error.code === 'UNKNOWN_OPERATION'
  );
});

test('the batch budget is clamped to the serverless-safe window', async () => {
  const { batchBudget, buildExecution } = await ready;
  assert.equal(batchBudget({ plan: { execution: buildExecution({ depth: 'auto' }) } }), 18000);
  assert.equal(batchBudget({ plan: { execution: buildExecution({ depth: 'deep' }) } }), 18000);
  assert.equal(batchBudget({ plan: { execution: { searchBudgetMs: 5000 } } }), 5000);
  assert.equal(batchBudget({ plan: { execution: { searchBudgetMs: 999999 } } }), 30000, 'a huge budget is clamped so a batch cannot outlive the function');
  assert.equal(batchBudget({ plan: { execution: { searchBudgetMs: -3 } } }), 18000, 'an invalid budget falls back to the default');
});
