'use strict';
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.RESEARCH_CONTROL_URL = 'local';
process.env.JOBSCOPE_LOCAL_STORE = path.join(os.tmpdir(), `jobscope-contracts-${process.pid}.json`);
fs.rmSync(process.env.JOBSCOPE_LOCAL_STORE, { force: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const { validate, assertValid } = require('../src/core/contracts/validate');
const { executeBatch } = require('../src/application/research-executor');
const { call } = require('../src/infrastructure/research-control-client');
const { buildQueryPlan, buildExecution } = require('../src/domain/research/query-planner');
const { canonicalKey } = require('../src/domain/research/entity-resolution');

const schemas = {
  run: require('../src/core/contracts/research-run.schema.json'),
  evidence: require('../src/core/contracts/evidence.schema.json'),
  opportunity: require('../src/core/contracts/job-opportunity.schema.json'),
  report: require('../src/core/contracts/report.schema.json')
};

function job(sourceId) {
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

const providers = {
  searchJobs: async (query, { sourceIds = [] } = {}) => {
    const providerId = sourceIds[0];
    return {
      documents: [],
      sources: [{ sourceKey: providerId, canonical_url: `https://${providerId}.net`, source_type: 'job_board', reliability: .7, metadata: {} }],
      jobs: [job(providerId)],
      evidence: [{ claim: `listing on ${providerId}`, sourceId: providerId, status: 'reported', confidence: .8, provenance: { url: `https://${providerId}.net/jobs/1` } }]
    };
  },
  searchWeb: async () => ({ documents: [], sources: [], jobs: [], evidence: [], links: [] })
};

async function completedRun() {
  const plan = buildQueryPlan({ goal: 'Data Entry', location: 'Alexandria', domain: 'jobs' });
  plan.execution = buildExecution({ depth: 'auto' });
  const created = await call({ op: 'create', goal: 'Data Entry', preferences: { minSalary: 7000 }, plan });
  let snapshot = null;
  for (let index = 0; index < 20; index++) {
    snapshot = (await executeBatch(created.accessToken, providers)).payload.run;
    if (snapshot.state === 'completed') break;
  }
  assert.equal(snapshot.state, 'completed');
  return { snapshot, token: created.accessToken };
}

test('the validator implements the subset the contracts rely on', () => {
  const schema = {
    $id: 'test://schema',
    type: 'object',
    required: ['name', 'count'],
    properties: {
      name: { type: 'string', minLength: 2 },
      count: { type: 'integer', minimum: 0 },
      kind: { enum: ['a', 'b'] },
      ratio: { type: ['number', 'null'], maximum: 1 }
    }
  };
  assert.deepEqual(validate({ name: 'ok', count: 1, kind: 'a', ratio: null }, schema), []);
  assert.equal(validate({ name: 'o', count: -1, kind: 'c' }, schema).length, 3);
  assert.match(validate({ count: 1 }, schema)[0], /required property "name"/);
  assert.throws(() => assertValid({ name: 'ok' }, schema), error => error.code === 'CONTRACT_VIOLATION');
});

test('a completed run satisfies the run, evidence and opportunity contracts', async () => {
  const { snapshot } = await completedRun();
  assert.deepEqual(validate(snapshot, schemas.run), []);

  const stored = await call({ op: 'snapshot' }, { token: (await completedRun()).token });
  for (const row of stored.evidence) assert.deepEqual(validate(row, schemas.evidence), [], JSON.stringify(row));
  for (const row of stored.opportunities) assert.deepEqual(validate(row, schemas.opportunity), [], JSON.stringify(row));
  assert.ok(stored.evidence.length > 0);
  assert.ok(stored.opportunities.length > 0);
});

test('the produced report satisfies the report contract', async () => {
  const { snapshot } = await completedRun();
  assert.deepEqual(validate(snapshot.report, schemas.report), []);
  assert.equal(snapshot.report.executive.evidenceCount, (snapshot.report.claims || []).length);
  for (const opportunity of snapshot.report.opportunities) {
    assert.ok(opportunity.key, 'every reported opportunity keeps its canonical key');
    assert.ok(Number.isInteger(opportunity.sourceCount));
  }
});

test('the contracts reject fabricated shapes', () => {
  assert.equal(validate({ verdict: 'buy' }, schemas.report).length > 0, true);
  assert.equal(validate({ claim: '', status: 'certain', confidence: 4 }, schemas.evidence).length, 3);
  assert.equal(validate({ id: 'x', canonical_key: 'k', decision_score: 900 }, schemas.opportunity).length, 1);
  assert.equal(validate({ id: 'x', type: 'research_run', version: '1.3', goalSnapshot: 'g', mode: 'balanced', state: 'sleeping', createdAt: 'not-a-date', updatedAt: 'nope' }, schemas.run).length > 0, true);
});
