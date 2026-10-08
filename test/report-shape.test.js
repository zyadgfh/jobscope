'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport } = require('../src/domain/research/report');
const { evaluateOpportunities } = require('../src/domain/research/decision-engine');
const { scoreOpportunity } = require('../src/domain/research/opportunity-scoring');

function executorShapedOpportunity() {
  const job = {
    id: 'opp-1',
    canonical_key: 'acme|data entry|alexandria',
    canonicalKey: 'acme|data entry|alexandria',
    title: 'Data Entry',
    company: 'Acme',
    location: 'Alexandria',
    salary: null,
    sourceId: 'source-1',
    sourceCount: 1
  };
  const objective = scoreOpportunity(job, { sourceReliability: .75, evidenceConfidence: .6, independentSources: 1 });
  return evaluateOpportunities([{ ...job, objectiveScore: objective.score, dataQuality: objective.dataQuality, riskFlags: objective.riskFlags, fitScore: null, fitSignals: [] }]);
}

test('buildReport accepts the exact shape the executor produces', () => {
  const report = buildReport({
    run: { id: 'run-1' },
    evidence: [{ claim: 'x', sourceId: 'source-1', status: 'reported', confidence: .6 }],
    recommendation: { status: 'ready' },
    opportunities: executorShapedOpportunity(),
    evidenceScore: { score: 50 },
    gaps: []
  });
  assert.equal(report.version, '1.3');
  assert.equal(report.runId, 'run-1');
  assert.equal(report.opportunities.length, 1);
  assert.equal(report.opportunities[0].key, 'acme|data entry|alexandria');
  assert.equal(report.opportunities[0].title, 'Data Entry');
  assert.equal(report.opportunities[0].sourceCount, 1);
  assert.equal(report.executive.evidenceCount, 1);
});

test('buildReport accepts storage-shaped rows (source_id, missing postings)', () => {
  const report = buildReport({
    run: { id: 'run-2' },
    evidence: [{ claim: 'stored', source_id: 'uuid-1', status: 'verified_fact', confidence: .9, retrieved_at: '2026-01-01T00:00:00.000Z' }],
    opportunities: [{ id: 'row-1', canonical_key: 'key-1', title: 'Stored row', decision_score: 71.5 }],
    gaps: [{ type: 'source_diversity' }]
  });
  assert.equal(report.executive.sourceCount, 1);
  assert.equal(report.claims[0].sourceId, 'uuid-1');
  assert.equal(report.claims[0].retrievedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(report.opportunities[0].decisionScore, 71.5);
  assert.equal(report.opportunities[0].sourceCount, 0);
});

test('buildReport survives empty and malformed input', () => {
  const report = buildReport({});
  assert.equal(report.runId, null);
  assert.deepEqual(report.opportunities, []);
  assert.equal(report.executive.recommendation.status, 'insufficient_evidence');
  const messy = buildReport({ run: { id: 'run-3' }, opportunities: [null, undefined, { postings: [{ sourceId: 'a' }, { source_id: 'b' }] }], evidence: null });
  assert.equal(messy.opportunities.length, 1);
  assert.equal(messy.opportunities[0].sourceCount, 2);
  assert.deepEqual(messy.claims, []);
});

test('a report never fabricates a decision score', () => {
  const report = buildReport({ run: { id: 'run-4' }, opportunities: [{ title: 'No score' }] });
  assert.equal(report.opportunities[0].decisionScore, null);
  assert.equal(report.opportunities[0].fitScore, null);
});
