const { createId } = require('../core/ids');
const { createResearchRun, canTransition } = require('../domain/research/research-run');

class ResearchService {
  constructor(store) {
    this.store = store;
    this.listeners = new Map();
  }

  create({ goal, mode, actorId }) {
    const run = createResearchRun({
      id: createId('run'),
      goal,
      mode,
      actorId
    });
    const saved = this.store.create(run);
    this.emit(saved.id, { type: 'run.created', runId: saved.id, state: saved.state, at: saved.createdAt });
    return saved;
  }

  get(id) {
    return this.store.get(id);
  }

  subscribe(id, listener) {
    const set = this.listeners.get(id) || new Set();
    set.add(listener);
    this.listeners.set(id, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(id);
    };
  }

  emit(id, event) {
    for (const listener of this.listeners.get(id) || []) listener(event);
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
    const saved = this.store.save(run);
    this.emit(id, { type: 'run.state_changed', runId: id, state: target, at: now });
    return saved;
  }

  pause(id) { return this.transition(id, 'paused'); }

  resume(id) {
    const run = this.store.get(id);
    if (!run) return null;
    const previous = [...run.timeline].reverse().find(x => x.state !== 'paused');
    const target = previous && previous.state !== 'created' ? previous.state : 'planning';
    return this.transition(id, target);
  }

  cancel(id) { return this.transition(id, 'cancelled'); }
}

module.exports = { ResearchService };
