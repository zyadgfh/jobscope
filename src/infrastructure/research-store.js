class InMemoryResearchRunStore {
  constructor() {
    this.runs = new Map();
  }

  create(run) {
    if (this.runs.has(run.id)) throw new Error('research run already exists');
    this.runs.set(run.id, structuredClone(run));
    return structuredClone(run);
  }

  get(id) {
    const run = this.runs.get(id);
    return run ? structuredClone(run) : null;
  }

  save(run) {
    if (!this.runs.has(run.id)) throw new Error('research run not found');
    run.updatedAt = new Date().toISOString();
    this.runs.set(run.id, structuredClone(run));
    return structuredClone(run);
  }
}

module.exports = { InMemoryResearchRunStore };
