const STATES = Object.freeze([
  'created',
  'planning',
  'searching',
  'extracting',
  'verifying',
  'scoring',
  'reporting',
  'completed',
  'paused',
  'cancelled',
  'failed'
]);

const TERMINAL = new Set(['completed', 'cancelled', 'failed']);

function canTransition(from, to) {
  if (from === to) return true;
  if (TERMINAL.has(from)) return false;
  if (to === 'paused') return from !== 'paused';
  if (from === 'paused') return ['planning', 'searching', 'extracting', 'verifying', 'scoring', 'reporting', 'cancelled'].includes(to);
  const order = ['created', 'planning', 'searching', 'extracting', 'verifying', 'scoring', 'reporting', 'completed'];
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  return a >= 0 && b === a + 1;
}

function createResearchRun({ id, goal, mode = 'balanced', actorId = 'guest' }) {
  if (!goal || typeof goal !== 'string' || !goal.trim()) throw new Error('goal is required');
  const now = new Date().toISOString();
  return {
    id,
    type: 'research_run',
    version: 1,
    goal: goal.trim(),
    goalSnapshot: goal.trim(),
    mode,
    actorId,
    state: 'created',
    createdAt: now,
    updatedAt: now,
    tasks: [],
    queries: [],
    sources: [],
    evidence: [],
    scores: [],
    recommendation: null,
    report: null,
    timeline: [{ state: 'created', at: now }],
    checkpoints: []
  };
}

module.exports = { STATES, canTransition, createResearchRun };
