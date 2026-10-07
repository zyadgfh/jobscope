const { createId } = require('../core/ids');
const { createResearchRun, canTransition } = require('../domain/research/research-run');

class ResearchService {
  constructor(store) {
    this.store = store;
  }

  create({ goal, mode, actorId }) {
    const run = createResearchRun({
      id: createId('run'),
      goal,
      mode,
      actorId
    });
    return this.store.create(run);
  }

  get(id) {
    return this.store.get(id);
  }

  transition(id, target) {
    const run = this.store.get(id);
    if (!run) return null;
    if (!canTransition(run.state, target)) {
      const error = new Error(`invalid research state transition: ${run.state} -> ${target}`);
      error.code = 'INVALID_STATE_TRANSITION';
      throw error;
    }
    const now = new Date().toISOString();
    run.state = target;
    run.updatedAt = now;
    run.timeline.push({ state: target, at: now });
    run.checkpoints.push({ state: target, at: now });
    return this.store.save(run);
  }

  pause(id) { return this.transition(id, 'paused'); }
  resume(id) {
    const run = this.store.get(id);
    if (!run) return null;
    const target = run.timeline.length > 1 ? run.timeline[run.timeline.length - 2].state : 'planning';
    return this.transition(id, target === 'paused' ? 'planning' : target);
  }
  cancel(id) { return this.transition(id, 'cancelled'); }
}

module.exports = { ResearchService };
