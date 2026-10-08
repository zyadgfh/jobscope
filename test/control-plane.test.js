'use strict';
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.RESEARCH_CONTROL_URL = 'local';
process.env.JOBSCOPE_LOCAL_STORE = path.join(os.tmpdir(), `jobscope-plane-${process.pid}.json`);
fs.rmSync(process.env.JOBSCOPE_LOCAL_STORE, { force: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const { call, normalizeToken, isPlausibleToken } = require('../src/infrastructure/research-control-client');
const { reset, resetLimits, reload } = require('../src/infrastructure/local-research-control');
const { buildQueryPlan, buildExecution } = require('../src/domain/research/query-planner');

async function newRun(goal = 'Data Entry') {
  // A fresh visitor: the create limit is per IP, exactly like the Edge Function.
  resetLimits();
  const plan = buildQueryPlan({ goal, location: 'Alexandria', domain: 'jobs' });
  plan.execution = buildExecution({ depth: 'auto' });
  const created = await call({ op: 'create', goal, preferences: { targetLocations: ['Alexandria'] }, plan });
  assert.ok(created.accessToken);
  return created;
}

async function expectCode(promise, code) {
  try {
    await promise;
    assert.fail(`expected rejection with ${code}`);
  } catch (error) {
    assert.equal(error.code, code, `expected ${code}, received ${error.code || error.message}`);
  }
}

test('tokens are compared by hash and never stored in clear', async () => {
  reset();
  const { run, accessToken } = await newRun();
  const store = JSON.parse(fs.readFileSync(process.env.JOBSCOPE_LOCAL_STORE, 'utf8'));
  const row = store.runs.find(entry => entry.id === run.id);
  assert.ok(row, 'the run was persisted');
  assert.notEqual(row.access_token_hash, accessToken);
  assert.equal(row.access_token_hash.length, 64);
  await expectCode(call({ op: 'get' }, { token: 'wrong-token-value-1234' }), 'UNAUTHORIZED');
  const read = await call({ op: 'get' }, { token: accessToken });
  assert.equal(read.run.id, run.id);
});

test('a store written by an older build is migrated instead of crashing', async () => {
  // Older builds keyed runs by id; the current one keeps an array.
  fs.writeFileSync(process.env.JOBSCOPE_LOCAL_STORE, JSON.stringify({
    runs: { 'legacy-1': { id: 'legacy-1', goal: 'old', state: 'created', plan: {} } },
    tokens: [],
    events: []
  }));
  reload();
  resetLimits();
  const created = await newRun('Migration check');
  assert.ok(created.run.id);
  const read = await call({ op: 'get' }, { token: created.accessToken });
  assert.equal(read.run.goal, 'Migration check');
  const store = JSON.parse(fs.readFileSync(process.env.JOBSCOPE_LOCAL_STORE, 'utf8'));
  assert.ok(Array.isArray(store.runs), 'the store is rewritten in the current shape');
  assert.ok(store.runs.some(run => run.id === 'legacy-1'), 'the legacy run survives');
});

test('a bearer prefix is tolerated exactly once', async () => {
  const { run, accessToken } = await newRun();
  const read = await call({ op: 'get' }, { token: 'Bearer ' + accessToken });
  assert.equal(read.run.id, run.id);
  assert.equal(normalizeToken('Bearer ' + accessToken), accessToken);
  assert.equal(isPlausibleToken(accessToken), true);
  assert.equal(isPlausibleToken('short'), false);
});

test('one run can never read another run data', async () => {
  reset();
  const first = await newRun('First goal');
  await call({
    op: 'ingest',
    sources: [{ sourceKey: 'wuzzuf', canonical_url: 'https://wuzzuf.net', source_type: 'job_board', reliability: .75, metadata: { provider: 'wuzzuf' } }],
    documents: [{ sourceId: 'wuzzuf', url: 'https://wuzzuf.net/jobs/secret-1', title: 'Secret posting', contentType: 'text/html', contentHash: 'hash-1', content: '<html>secret</html>', retrievalMethod: 'http', retrievedAt: new Date().toISOString() }],
    jobs: [{ canonicalKey: 'private|data entry|alexandria', title: 'Data Entry', company: 'Private Co', url: 'https://wuzzuf.net/jobs/secret-1', sourceId: 'wuzzuf' }],
    evidence: [{ claim: 'private claim', sourceId: 'wuzzuf', status: 'reported', confidence: .7, provenance: { url: 'https://wuzzuf.net/jobs/secret-1' } }]
  }, { token: first.accessToken });

  const second = await newRun('Second goal');
  const snapshot = await call({ op: 'snapshot' }, { token: second.accessToken });
  assert.deepEqual(snapshot.evidence, []);
  assert.deepEqual(snapshot.documents, []);
  assert.deepEqual(snapshot.sources, []);
  assert.deepEqual(snapshot.opportunities, []);
  assert.deepEqual(snapshot.postings, []);

  const own = await call({ op: 'snapshot' }, { token: first.accessToken });
  assert.equal(own.documents.length, 1);
  assert.equal(own.sources.length, 1, 'a run keeps seeing the sources it actually used');
});

test('verified facts require an independent cross-source verification', async () => {
  reset();
  const { accessToken } = await newRun();
  await call({
    op: 'ingest',
    evidence: [
      { claim: 'self declared', sourceId: null, status: 'verified_fact', confidence: 1, provenance: {} },
      { claim: 'claimed with one source', sourceId: null, status: 'verified_fact', confidence: 1, provenance: { verificationMethod: 'cross_source_core_v1', independentSources: ['a'] } },
      { claim: 'true cross-source', sourceId: null, status: 'verified_fact', confidence: .9, provenance: { verificationMethod: 'cross_source_core_v1', independentSources: ['a', 'b'] } },
      { claim: 'bogus status', sourceId: null, status: 'definitely_true', confidence: .5, provenance: {} }
    ]
  }, { token: accessToken });
  const snapshot = await call({ op: 'snapshot' }, { token: accessToken });
  const byClaim = new Map(snapshot.evidence.map(row => [row.claim, row.status]));
  assert.equal(byClaim.get('self declared'), 'reported');
  assert.equal(byClaim.get('claimed with one source'), 'reported');
  assert.equal(byClaim.get('true cross-source'), 'verified_fact');
  assert.equal(byClaim.get('bogus status'), 'reported');
});

test('the state machine rejects illegal transitions', async () => {
  reset();
  const { accessToken } = await newRun();
  await expectCode(call({ op: 'transition', target: 'verifying' }, { token: accessToken }), 'INVALID_STATE_TRANSITION');
  await expectCode(call({ op: 'transition', target: 'nonsense' }, { token: accessToken }), 'INVALID_STATE_TRANSITION');
  const planned = await call({ op: 'transition', target: 'planning' }, { token: accessToken });
  assert.equal(planned.run.state, 'planning');
  const paused = await call({ op: 'transition', target: 'paused' }, { token: accessToken });
  assert.equal(paused.run.pausedFrom, 'planning');
  const resumed = await call({ op: 'transition', target: 'resume' }, { token: accessToken });
  assert.equal(resumed.run.state, 'planning');
});

test('tasks can be created, updated and read back', async () => {
  reset();
  const { run, accessToken } = await newRun();
  const created = await call({ op: 'task', taskKey: 'expand_1_1_wuzzuf', status: 'pending', createIfMissing: true, taskType: 'search', query: 'Data Entry vacancy Alexandria' }, { token: accessToken });
  assert.equal(created.task.task_key, 'expand_1_1_wuzzuf');
  await call({ op: 'task', taskKey: 'expand_1_1_wuzzuf', status: 'running', attempts: 0 }, { token: accessToken });
  const snapshot = await call({ op: 'snapshot' }, { token: accessToken });
  const task = snapshot.run.tasks.find(row => row.task_key === 'expand_1_1_wuzzuf');
  assert.equal(task.status, 'running');
  assert.equal(task.attempts, 1);
  assert.equal(run.tasks.length > 0, true);
});

test('revoked tokens stop working', async () => {
  reset();
  const { accessToken } = await newRun();
  const revoked = await call({ op: 'revoke' }, { token: accessToken });
  assert.equal(revoked.ok, true);
  await expectCode(call({ op: 'get' }, { token: accessToken }), 'UNAUTHORIZED');
});

test('fork and retry create independent child runs', async () => {
  reset();
  const { run, accessToken } = await newRun();
  await expectCode(call({ op: 'retry' }, { token: accessToken }), 'RETRY_REQUIRES_FAILED_RUN');
  const forked = await call({ op: 'fork' }, { token: accessToken });
  assert.notEqual(forked.run.id, run.id);
  assert.equal(forked.run.parentRunId, run.id);
  assert.equal(forked.run.revision, 2);
  const childSnapshot = await call({ op: 'snapshot' }, { token: forked.accessToken });
  assert.equal(childSnapshot.run.tasks.length, run.tasks.length);
  assert.equal(childSnapshot.evidence.length, 0);
});
