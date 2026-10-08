'use strict';
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// The whole suite runs the real request lifecycle against the in-process control plane.
process.env.RESEARCH_CONTROL_URL = 'local';
process.env.JOBSCOPE_LOCAL_STORE = path.join(os.tmpdir(), `jobscope-e2e-${process.pid}.json`);
fs.rmSync(process.env.JOBSCOPE_LOCAL_STORE, { force: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const { invoke } = require('./helpers/shims');
const createRun = require('../api/research/runs/index.js');
const runById = require('../api/research/runs/[id].js');
const executeRun = require('../api/research/runs/execute/[id].js');
const sourceFetch = require('../api/research/sources/fetch.js');
const { executeBatch } = require('../src/application/research-executor');
const { canonicalKey } = require('../src/domain/research/entity-resolution');

function jobFor(sourceId, suffix, overrides = {}) {
  const job = {
    title: 'Data Entry Specialist',
    company: 'Acme Ltd',
    location: 'Alexandria',
    salary: { currency: 'EGP', frequency: 'month', amount: { min: 7000, max: 9000 } },
    description: 'Excel data entry with training',
    requirements: ['Excel'],
    employment: { type: 'FULL_TIME', datePosted: new Date().toISOString(), workMode: 'onsite' },
    url: `https://${sourceId}.example/jobs/${suffix}`,
    sourceId,
    confidence: .9,
    ...overrides
  };
  return { ...job, canonicalKey: canonicalKey(job) };
}

function provider(searchJobs) {
  return {
    searchJobs,
    searchWeb: async () => ({ documents: [], sources: [], jobs: [], evidence: [], links: [] })
  };
}

const bothBoards = async (query, { sourceIds = [] } = {}) => {
  const providerId = sourceIds[0];
  // The same opening is listed on both boards, which must verify across sources.
  return {
    documents: [],
    sources: [{ sourceKey: providerId, canonical_url: `https://${providerId}.net`, source_type: 'job_board', reliability: .7, metadata: {} }],
    jobs: [jobFor(providerId, 'shared')],
    evidence: [{
      claim: `Source ${providerId} lists a job opportunity: Data Entry Specialist`,
      sourceId: providerId,
      status: 'reported',
      confidence: .8,
      provenance: { url: `https://${providerId}.net/jobs/shared` }
    }]
  };
};

async function createResearchRun(goal = 'Data Entry') {
  const created = await invoke(createRun, {
    method: 'POST',
    url: '/api/research/runs',
    body: { goal, location: 'Alexandria', domain: 'jobs', depth: 'auto', preferences: { minSalary: 7000, targetLocations: ['Alexandria'], requiredKeywords: ['excel'], workMode: 'any' } }
  });
  assert.equal(created.status, 201);
  assert.ok(created.body.accessToken, 'create must return an access token');
  assert.ok(created.body.run.id);
  return created.body;
}

async function driveToCompletion(accessToken, search = provider(bothBoards)) {
  let snapshot = null;
  let batches = 0;
  for (; batches < 30; batches++) {
    const result = await executeBatch(accessToken, search);
    snapshot = result.payload.run;
    if (['completed', 'failed', 'cancelled'].includes(snapshot.state)) break;
  }
  return { snapshot, batches };
}

test('opaque access tokens are accepted end to end', async () => {
  const { run, accessToken } = await createResearchRun();
  assert.match(accessToken, /^[A-Za-z0-9_-]{16,}$/, 'control plane issues an opaque token');
  assert.equal(accessToken.split('.').length, 1, 'token must not be required to look like a JWT');

  const read = await invoke(runById, { method: 'GET', url: `/api/research/runs/${run.id}`, token: accessToken });
  assert.equal(read.status, 200, 'GET with "Bearer <token>" must be authorized');
  assert.equal(read.body.run.id, run.id);

  // Drive the run with deterministic providers, then assert the deployed handler
  // accepts the same token (no network access required).
  await driveToCompletion(accessToken);
  const executed = await invoke(executeRun, { method: 'POST', url: `/api/research/runs/execute/${run.id}`, token: accessToken });
  assert.equal(executed.status, 200, 'the executor must accept the token shape the control plane issues');
  assert.equal(executed.body.run.state, 'completed');
});

test('the control plane, not a token shape, decides authority', async () => {
  const forged = await invoke(runById, { method: 'GET', url: '/api/research/runs/00000000', token: 'a.b.c' });
  assert.equal(forged.status, 401);
  const missing = await invoke(executeRun, { method: 'POST', url: '/api/research/runs/execute/0000', token: '' });
  assert.equal(missing.status, 401);
});

test('a full run reaches completed and produces a report', async () => {
  const { accessToken } = await createResearchRun('Data Entry');
  const { snapshot, batches } = await driveToCompletion(accessToken);
  assert.notEqual(snapshot.state, 'failed', 'execution must not fail while finalizing');
  assert.equal(snapshot.state, 'completed', 'batch machine must terminate in completed');
  assert.ok(batches < 20, `expansion must be bounded, saw ${batches} batches`);

  const report = snapshot.report;
  assert.equal(report.version, '1.3');
  assert.ok(Array.isArray(report.opportunities), 'report.opportunities is a list of opportunities');
  assert.equal(report.opportunities.length, snapshot.opportunities.length);
  assert.ok(report.stopping && report.stopping.reason, 'the run records why it stopped');
  assert.ok(snapshot.recommendation, 'a recommendation is attached');

  const verified = (report.claims || []).filter(claim => claim.status === 'verified_fact');
  assert.equal(verified.length, 1, 'cross-source verification produces one verified fact');
  assert.equal(report.evidenceScore.score > 0, true, 'evidence quality is scored');

  const opportunity = snapshot.opportunities[0];
  assert.ok(Number.isFinite(Number(opportunity.decision_score)), 'opportunities persist a decision score');
  assert.equal(opportunity.fit && opportunity.fit.score > 0, true, 'preferences are applied to personal fit');

  const expandTasks = (snapshot.tasks || []).filter(item => /^expand_/.test(item.task_key));
  assert.ok(expandTasks.length <= 3, 'expansion honours maxExpansionTasks');
});

test('a run that finds nothing still terminates (bounded expansion)', async () => {
  const created = await invoke(createRun, {
    method: 'POST',
    url: '/api/research/runs',
    body: { goal: 'Role that does not exist', location: 'Nowhere', domain: 'jobs', depth: 'deep' }
  });
  const { run, accessToken } = created.body;
  const emptyProvider = {
    searchJobs: async (query, { sourceIds = [] } = {}) => ({
      documents: [],
      sources: [{ sourceKey: sourceIds[0], canonical_url: `https://${sourceIds[0]}.net`, source_type: 'job_board', reliability: .7, metadata: {} }],
      jobs: [],
      evidence: []
    }),
    searchWeb: async () => ({ documents: [], sources: [], jobs: [], evidence: [], links: [] })
  };
  const { snapshot, batches } = await driveToCompletion(accessToken, emptyProvider);
  assert.equal(snapshot.state, 'completed', 'open gaps must not keep the run alive forever');
  assert.ok(batches < 25, `expansion must terminate, saw ${batches} batches`);
  const expandTasks = (snapshot.tasks || []).filter(item => /^expand_/.test(item.task_key));
  assert.ok(expandTasks.length <= 5, 'deep runs honour maxExpansionTasks');
  assert.equal(snapshot.report.stopping.reason === 'expansion_rounds_exhausted'
    || snapshot.report.stopping.reason === 'expansion_task_budget_exhausted'
    || snapshot.report.stopping.reason === 'gaps_unchanged', true, 'a termination reason is recorded');
  assert.ok((snapshot.report.gaps || []).length > 0, 'remaining gaps stay visible in the report');
  assert.equal(run.id, snapshot.id);
});

test('provider failures are visible instead of silently swallowed', async () => {
  const created = await invoke(createRun, {
    method: 'POST',
    url: '/api/research/runs',
    body: { goal: 'Unreachable board', location: 'Nowhere', domain: 'jobs', depth: 'auto' }
  });
  const { accessToken } = created.body;
  const failing = {
    searchJobs: async () => {
      throw Object.assign(new Error('wuzzuf search failed: connect ECONNREFUSED'), { code: 'PROVIDER_FAILED' });
    },
    searchWeb: async () => ({ documents: [], sources: [], jobs: [], evidence: [], links: [] })
  };
  const { snapshot } = await driveToCompletion(accessToken, failing);
  const searchTasks = snapshot.tasks.filter(task => task.task_type === 'search');
  assert.equal(searchTasks.every(task => task.status === 'failed'), true, 'every provider failure is recorded on its task');
  assert.ok(searchTasks.every(task => /ECONNREFUSED/.test(task.last_error || '')), 'the failure reason is kept');
  assert.equal(snapshot.state, 'completed', 'a failed provider does not kill the run');
  assert.ok((snapshot.report.gaps || []).some(gap => gap.type === 'source_failure'), 'failures are reported as a gap');
});

test('paused runs answer 409 and can be resumed', async () => {
  const { run, accessToken } = await createResearchRun('Pause test');
  await executeBatch(accessToken, provider(bothBoards));
  const paused = await invoke(runById, { method: 'POST', url: `/api/research/runs/${run.id}?action=pause`, token: accessToken });
  assert.equal(paused.status, 200);
  assert.equal(paused.body.run.state, 'paused');

  const blocked = await invoke(executeRun, { method: 'POST', url: `/api/research/runs/execute/${run.id}`, token: accessToken });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, 'PAUSED_RUN');

  const resumed = await invoke(runById, { method: 'POST', url: `/api/research/runs/${run.id}?action=resume`, token: accessToken });
  assert.equal(resumed.status, 200);
  assert.ok(['planning', 'searching'].includes(resumed.body.run.state));
});

test('the retrieval endpoint requires a token', async () => {
  const anonymous = await invoke(sourceFetch, { method: 'POST', url: '/api/research/sources/fetch', body: { url: 'https://wuzzuf.net/' } });
  assert.equal(anonymous.status, 401);
  const { accessToken } = await createResearchRun('Fetch test');
  const blocked = await invoke(sourceFetch, { method: 'POST', url: '/api/research/sources/fetch', token: accessToken, body: { url: 'http://0.0.0.0/' } });
  assert.equal(blocked.status, 400, 'private targets stay blocked behind the token gate');
  assert.equal(blocked.body.error, 'SSRF_BLOCKED');
});
