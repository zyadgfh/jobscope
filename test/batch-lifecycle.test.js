'use strict';

// End-to-end coverage of the pipeline the deployment actually runs:
//   api/research/runs/index.js  ->  control plane  ->  executeBatch  ->  report
// Search providers are injected, so the test is deterministic and never touches
// the network while still exercising the real handlers, executor and contracts.

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.RESEARCH_CONTROL_URL = 'local';
process.env.JOBSCOPE_LOCAL_STORE = path.join(os.tmpdir(), `jobscope-batch-lifecycle-${process.pid}.json`);
fs.rmSync(process.env.JOBSCOPE_LOCAL_STORE, { force: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const { invoke } = require('./helpers/shims');
const createRun = require('../api/research/runs/index.js');
const runById = require('../api/research/runs/[id].js');
const executeRoute = require('../api/research/runs/execute/[id].js');
const { executeBatch } = require('../src/application/research-executor');
const { canonicalKey } = require('../src/domain/research/entity-resolution');
const { reset } = require('../src/infrastructure/local-research-control');

function job(url, extra = {}) {
  const base = {
    title: 'Data Entry Specialist',
    company: 'Acme Ltd',
    location: 'Alexandria',
    salary: { currency: 'EGP', frequency: 'month', amount: { min: 6000, max: 8000 } },
    description: 'Excel data entry',
    requirements: ['Excel'],
    employment: { type: 'FULL_TIME', datePosted: new Date().toISOString(), workMode: 'onsite' },
    url,
    sourceId: url.includes('wuzzuf') ? 'wuzzuf' : 'forasna',
    confidence: .85
  };
  return { ...base, ...extra, canonicalKey: canonicalKey({ ...base, ...extra }) };
}

function providerResult(url) {
  const sourceId = url.includes('wuzzuf') ? 'wuzzuf' : 'forasna';
  return {
    documents: [{ url, title: 'Data Entry Specialist', content: '<html>job</html>', contentType: 'text/html', retrievalMethod: 'http', sourceId, contentHash: 'h-' + sourceId }],
    sources: [{ sourceKey: sourceId, canonical_url: 'https://' + sourceId + '.net', source_type: 'job_board', reliability: .7, metadata: { provider: sourceId } }],
    jobs: [job(url)],
    evidence: [{
      claim: sourceId + ' lists a Data Entry Specialist role',
      sourceId,
      status: 'reported',
      confidence: .8,
      provenance: { url, extraction: 'json-ld', evidenceKey: 'job-' + sourceId }
    }]
  };
}

// The same board answers both providers, but with per-provider URLs so two
// independent postings exist for the cross-source verification path.
const searchJobs = async (query, options) => {
  assert.equal(typeof query, 'string');
  assert.ok(options.timeBudgetMs > 0, 'each provider call carries the batch budget');
  const sourceId = options.sourceIds[0];
  return providerResult(`https://${sourceId}.net/jobs/1`);
};
const searchWeb = async () => ({ documents: [], sources: [], jobs: [], evidence: [], links: [] });

// Each create pretends to come from a different visitor so the per-IP create
// limit (5/minute, same as the Edge Function) does not fire inside the suite.
let visitor = 10;
async function createRunFor(goal, extra = {}, ip) {
  visitor += 1;
  const response = await invoke(createRun, {
    method: 'POST',
    url: '/api/research/runs',
    headers: { 'x-forwarded-for': ip || '203.0.113.' + visitor },
    body: { goal, location: 'Alexandria', domain: 'jobs', depth: 'auto', preferences: { minSalary: 7000 }, ...extra }
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

// The batch endpoint delegates to executeBatch; driving that seam lets the test
// inject deterministic providers while still using the real handlers for create,
// read, pause and resume.
async function drain(token, limit = 20, providers = { searchJobs, searchWeb }) {
  let last = null;
  for (let index = 0; index < limit; index++) {
    const response = await executeBatch(token, providers);
    assert.equal(response.status, 200, JSON.stringify(response.payload));
    last = response.payload;
    if (last.continue === false) return last;
  }
  throw new Error('the run did not terminate within ' + limit + ' batches');
}

test.before(() => reset());

test('a run created through the API executes to a decision report', async () => {
  const created = await createRunFor('Data Entry', { depth: 'deep' });
  assert.ok(created.accessToken, 'the API returns an access token');
  assert.equal(created.run.state, 'created');
  assert.equal(created.run.plan.version, '1.3');
  assert.equal(created.run.plan.execution.searchBudgetMs, 18000);

  const final = await drain(created.accessToken);
  assert.equal(final.phase, 'completed');
  assert.equal(final.continue, false);
  assert.ok(final.stopping?.reason, 'a stop reason is always recorded');

  const read = await invoke(runById, { method: 'GET', url: '/api/research/runs/' + created.run.id, token: created.accessToken });
  assert.equal(read.status, 200);
  assert.equal(read.body.run.state, 'completed');
  assert.equal(read.body.run.report.version, '1.3');
  assert.ok(read.body.run.report.executive.evidenceCount >= 2);
  assert.ok(['insufficient_evidence', 'ready'].includes(read.body.run.recommendation.status));
  assert.ok(read.body.run.recommendation.decision);
  assert.ok(Array.isArray(read.body.run.opportunities));
  assert.ok(read.body.run.opportunities.length >= 1, 'an opportunity was extracted');
  assert.ok(read.body.run.opportunities[0].decision_score !== undefined, 'the decision score is stored');
});

test('the batch loop is bounded by the plan, not by the number of gaps', async () => {
  const created = await createRunFor('Warehouse Picker', { depth: 'auto' });
  // A single source with no salary leaves open gaps (source diversity, salary
  // coverage), which is exactly what triggers the expansion path.
  const sparse = async (query, options) => {
    if (options.sourceIds[0] !== 'wuzzuf') return { documents: [], sources: [], jobs: [], evidence: [], links: [] };
    const bare = job('https://wuzzuf.net/jobs/9');
    delete bare.salary;
    return { ...providerResult('https://wuzzuf.net/jobs/9'), jobs: [bare] };
  };
  const batches = [];
  for (let index = 0; index < 12; index++) {
    const response = await executeBatch(created.accessToken, { searchJobs: sparse, searchWeb });
    batches.push(response.payload);
    if (response.payload.continue === false) break;
  }
  const last = batches[batches.length - 1];
  assert.equal(last.continue, false, 'the loop terminates on its own');
  assert.ok(batches.length <= 8, `bounded batches, saw ${batches.length}`);

  const read = await invoke(runById, { method: 'GET', url: '/api/research/runs/x', token: created.accessToken });
  const expansion = read.body.run.tasks.filter(task => /^expand_/.test(task.task_key));
  assert.ok(expansion.length <= 3, 'auto depth allows at most three expansion tasks');
  assert.ok(expansion.length >= 1, 'the expansion path really ran');
  assert.ok(read.body.run.tasks.every(task => task.status !== 'pending' || task.task_type === 'verification'), 'no search task is left pending');
});

test('a provider outage fails the task and surfaces a gap instead of fabricating data', async () => {
  const created = await createRunFor('Night Shift Cashier');
  const broken = async () => {
    throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'PROVIDER_FAILED' });
  };
  let final = null;
  for (let index = 0; index < 12; index++) {
    const response = await executeBatch(created.accessToken, { searchJobs: broken, searchWeb: broken });
    final = response.payload;
    if (final.continue === false) break;
  }
  assert.equal(final.phase, 'completed');
  const read = await invoke(runById, { method: 'GET', url: '/api/research/runs/x', token: created.accessToken });
  const searchTasks = read.body.run.tasks.filter(task => task.status === 'failed');
  assert.ok(searchTasks.length >= 1, 'the failing provider is recorded as a failed task');
  assert.match(String(searchTasks[0].last_error), /ECONNREFUSED|search failed/, 'the failure reason is preserved');
  assert.equal(read.body.run.evidenceSummary.total, 0);
  const gaps = read.body.run.report.gaps.map(gap => gap.type);
  assert.ok(gaps.includes('source_failure'), 'the outage is reported as a source_failure gap: ' + gaps.join(','));
});

test('an empty result set terminates instead of looping', async () => {
  const created = await createRunFor('Nonexistent Role Xyzzy');
  const empty = async () => ({ documents: [], sources: [], jobs: [], evidence: [], links: [] });
  let final = null;
  for (let index = 0; index < 10; index++) {
    const response = await executeBatch(created.accessToken, { searchJobs: empty, searchWeb: empty });
    final = response.payload;
    if (final.continue === false) break;
  }
  assert.equal(final.phase, 'completed');
  assert.ok(['no_opportunities', 'evidence', 'source_diversity', 'gaps_unchanged', 'no_queries', 'expansion_rounds_exhausted']
    .includes(final.stopping.reason), 'unexpected stop reason: ' + final.stopping.reason);
});

test('a paused run refuses further batches until it resumes', async () => {
  const created = await createRunFor('Paused Role');
  const paused = await invoke(runById, { method: 'POST', url: '/api/research/runs/x?action=pause', token: created.accessToken });
  assert.equal(paused.status, 200);
  assert.equal(paused.body.run.state, 'paused');

  const refused = await invoke(executeRoute, { method: 'POST', url: '/api/research/runs/execute/x', token: created.accessToken });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'PAUSED_RUN');

  const resumed = await invoke(runById, { method: 'POST', url: '/api/research/runs/x?action=resume', token: created.accessToken });
  assert.equal(resumed.status, 200);
  assert.ok(['created', 'planning', 'searching'].includes(resumed.body.run.state));

  const final = await drain(created.accessToken);
  assert.equal(final.phase, 'completed');
});

test('execution requires a token and rejects an implausible one', async () => {
  const anonymous = await invoke(executeRoute, { method: 'POST', url: '/api/research/runs/execute/x' });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.error, 'UNAUTHORIZED');

  const bogus = await invoke(executeRoute, { method: 'POST', url: '/api/research/runs/execute/x', token: 'short' });
  assert.equal(bogus.status, 401);
  assert.equal(bogus.body.error, 'INVALID_ACCESS_TOKEN');

  const unknown = await invoke(executeRoute, { method: 'POST', url: '/api/research/runs/execute/x', token: 'z'.repeat(43) });
  assert.equal(unknown.status, 401);

  const readAnon = await invoke(runById, { method: 'GET', url: '/api/research/runs/x' });
  assert.equal(readAnon.status, 401);
});

test('the batch endpoint maps an unexpected executor crash to a JSON error', async () => {
  const created = await createRunFor('Crash Handling');
  // Patch the executor seam the same way the API handler uses it: this asserts the
  // handler converts a thrown executor error into a status + code, never a stack.
  const original = require('../src/application/research-executor');
  const patched = { ...original, executeBatch: async () => { throw Object.assign(new Error('boom'), { code: 'EXPLODED', status: 503 }); } };
  require.cache[require.resolve('../src/application/research-executor')].exports = patched;
  delete require.cache[require.resolve('../src/api/execute-core')];
  const executeWithCrash = require('../src/api/execute-core').executeRun;
  const response = await invoke(executeWithCrash, { method: 'POST', url: '/api/research/runs/execute/x', token: created.accessToken });
  assert.equal(response.status, 503);
  assert.equal(response.body.error, 'EXPLODED');
  assert.equal(response.body.message, 'boom');

  require.cache[require.resolve('../src/application/research-executor')].exports = original;
  delete require.cache[require.resolve('../src/api/execute-core')];
});

test('a failed provider is a failed task, never a fabricated source row', async () => {
  const created = await createRunFor('Silent Failure Check');
  // search-service itself must throw rather than synthesising a provider row.
  const realFetch = require('../src/application/job-board-search');
  assert.equal(typeof realFetch.searchJobBoard, 'function');
  const broken = async () => { throw Object.assign(new Error('board down'), { code: 'PROVIDER_FAILED' }); };
  const response = await executeBatch(created.accessToken, { searchJobs: broken, searchWeb: broken });
  assert.equal(response.status, 200);
  const read = await invoke(runById, { method: 'GET', url: '/api/research/runs/x', token: created.accessToken });
  const fake = read.body.run.evidenceSummary.total;
  assert.equal(fake, 0, 'a failed provider contributed no evidence');
  assert.ok(!JSON.stringify(read.body.run).includes(':error'), 'no provider:error source rows exist');
});
