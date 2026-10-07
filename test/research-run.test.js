const test = require('node:test');
const assert = require('node:assert/strict');
const { createResearchRun, canTransition } = require('../src/domain/research/research-run');

test('research run starts with immutable goal snapshot', () => {
  const run = createResearchRun({ id: 'run_test', goal: 'Find data entry jobs', mode: 'balanced' });
  assert.equal(run.state, 'created');
  assert.equal(run.goalSnapshot, 'Find data entry jobs');
  assert.deepEqual(run.timeline.map(x => x.state), ['created']);
});

test('research lifecycle permits sequential progression', () => {
  assert.equal(canTransition('created', 'planning'), true);
  assert.equal(canTransition('planning', 'searching'), true);
  assert.equal(canTransition('searching', 'extracting'), true);
  assert.equal(canTransition('searching', 'verifying'), false);
  assert.equal(canTransition('completed', 'searching'), false);
});

test('paused runs can resume into an active state', () => {
  assert.equal(canTransition('searching', 'paused'), true);
  assert.equal(canTransition('paused', 'searching'), true);
  assert.equal(canTransition('paused', 'cancelled'), true);
});
