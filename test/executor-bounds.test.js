'use strict';
process.env.RESEARCH_CONTROL_URL = 'local';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessExpansion, expansionBounds, gapSignature } = require('../src/application/research-executor');
const { buildExecution } = require('../src/domain/research/query-planner');

function runShell({ tasks = [], domain = 'jobs', execution } = {}) {
  return {
    id: 'run-x',
    goal: 'Data Entry',
    plan: { domain, intent: { location: 'Alexandria' }, execution: execution || buildExecution({ depth: 'auto' }) },
    tasks
  };
}

function emptySnapshot() {
  return { opportunities: [], postings: [], evidence: [], sources: [] };
}

test('expansion bounds come from the plan and never exceed the executor ceiling', () => {
  assert.deepEqual(expansionBounds(runShell()), { maxRounds: 1, maxTasks: 3 });
  assert.deepEqual(expansionBounds(runShell({ execution: buildExecution({ depth: 'deep' }) })), { maxRounds: 2, maxTasks: 5 });
  assert.deepEqual(expansionBounds(runShell({ execution: { maxExpansionRounds: 99, maxExpansionTasks: 99 } })), { maxRounds: 2, maxTasks: 6 });
  assert.deepEqual(expansionBounds(runShell({ execution: { maxExpansionRounds: -3, maxExpansionTasks: 0 } })), { maxRounds: 0, maxTasks: 1 });
  assert.deepEqual(buildExecution({ depth: 'deep' }).maxExpansionTasks, 5);
});

test('open gaps with an exhausted budget stop expanding', () => {
  const tasks = [1, 2, 3].map(index => ({ task_key: `expand_1_${index}_wuzzuf`, task_type: 'search', status: 'completed' }));
  const assessment = assessExpansion(runShell({ tasks }), emptySnapshot());
  assert.equal(assessment.reason, 'expansion_task_budget_exhausted');
  assert.equal(assessment.round, null);
  assert.deepEqual(assessment.queries, []);
  assert.equal(assessment.gaps.length > 0, true, 'gaps are still reported');
});

test('the round counter advances so a run cannot loop forever', () => {
  const oneRound = [{ task_key: 'expand_1_1_wuzzuf', task_type: 'search', status: 'completed' }];
  const auto = assessExpansion(runShell({ tasks: oneRound }), emptySnapshot());
  assert.equal(auto.nextRound, 2, 'next round is previous + 1, never the same round again');
  assert.equal(auto.reason, 'expansion_rounds_exhausted', 'auto depth allows a single expansion round');
  assert.equal(auto.round, null);

  const deep = assessExpansion(runShell({ tasks: oneRound, execution: buildExecution({ depth: 'deep' }) }), emptySnapshot());
  assert.equal(deep.round, 2, 'deep runs may use the second round');
  assert.equal(deep.reason, 'ready');
});

test('unchanged gaps after an expansion round stop further work', () => {
  const snapshot = emptySnapshot();
  const signature = gapSignature(assessExpansion(runShell(), snapshot).gaps);
  const tasks = [
    { task_key: 'expand_1_1_wuzzuf', task_type: 'search', status: 'completed' },
    { task_key: `gapsig_1_${signature}`, task_type: 'internal', status: 'completed' }
  ];
  const assessment = assessExpansion(runShell({ tasks, execution: buildExecution({ depth: 'deep' }) }), snapshot);
  assert.equal(assessment.reason, 'gaps_unchanged');
  assert.equal(assessment.round, null);
});

test('no gaps means nothing to expand', () => {
  const snapshot = {
    opportunities: [{ id: 'o1', canonical_key: 'k', title: 'Data Entry', company: 'Acme', location: 'Alexandria', salary: { currency: 'EGP', amount: 8000 } }],
    postings: [{ opportunity_id: 'o1', source_id: 's1' }, { opportunity_id: 'o1', source_id: 's2' }],
    evidence: [{ source_id: 's1', claim: 'a' }, { source_id: 's2', claim: 'b' }],
    sources: []
  };
  const assessment = assessExpansion(runShell(), snapshot);
  assert.deepEqual(assessment.gaps, []);
  assert.equal(assessment.reason, 'no_gaps');
  assert.equal(assessment.round, null);
});

test('gap signatures are order independent', () => {
  assert.equal(gapSignature([{ type: 'b' }, { type: 'a' }, { type: 'a' }]), 'a+b');
  assert.equal(gapSignature([]), 'none');
});
