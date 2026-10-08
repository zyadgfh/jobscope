'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

/*
 * In-process control plane mirroring supabase/functions/research-control.
 * It exists so `npm start` runs the real request lifecycle without cloud
 * credentials, and so integration tests can exercise the production code path.
 */

const STORE_PATH = process.env.JOBSCOPE_LOCAL_STORE || path.join(os.tmpdir(), 'jobscope-local-control.json');
const { STATES: LIFECYCLE_STATES, TRANSITIONS } = require('../domain/research/research-run');
const STATES = new Set(LIFECYCLE_STATES);
const EDGES = new Map(Object.entries(TRANSITIONS).map(([from, to]) => [from, new Set(to)]));
const ALLOWED_EVIDENCE = new Set(['verified_fact', 'reported', 'estimated', 'inferred', 'unknown', 'conflicting']);
const MAX_PAYLOAD = 2500000;

const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const makeToken = () => crypto.randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const nowIso = () => new Date().toISOString();
const clean = (value, max = 2000) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

function fail(error, status = 400) {
  return Object.assign(new Error(String(error)), { code: error, status });
}

function emptyStore() {
  return { runs: {}, tasks: {}, evidence: [], sources: [], documents: [], opportunities: [], postings: [] };
}

let store = null;

function load() {
  if (store) return store;
  try {
    store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    for (const key of Object.keys(emptyStore())) if (!(key in store)) store[key] = emptyStore()[key];
  } catch {
    store = emptyStore();
  }
  return store;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(store));
  } catch {
    // Local persistence is a convenience; a read-only filesystem must not break requests.
  }
}

function reset() {
  store = emptyStore();
  persist();
}

function tasksOf(runId) {
  return load().tasks[runId] || [];
}

function materialize(run) {
  const db = load();
  const evidence = db.evidence.filter(e => e.run_id === run.id);
  const totals = {};
  for (const item of evidence) totals[item.status] = (totals[item.status] || 0) + 1;
  return {
    id: run.id,
    type: 'research_run',
    version: '1.3',
    actorId: run.actor_id,
    goal: run.goal,
    goalSnapshot: run.goal_snapshot,
    mode: run.mode,
    state: run.state,
    pausedFrom: run.paused_from || null,
    parentRunId: run.parent_run_id || null,
    revision: run.revision || 1,
    preferences: run.preferences || {},
    plan: run.plan,
    tasks: tasksOf(run.id).map(t => ({
      task_key: t.task_key,
      task_type: t.task_type,
      query: t.query,
      status: t.status,
      attempts: t.attempts,
      last_error: t.last_error || null
    })),
    opportunities: db.opportunities.filter(o => o.run_id === run.id),
    evidenceSummary: {
      total: evidence.length,
      byStatus: totals,
      sourceCount: new Set(evidence.map(e => e.source_id).filter(Boolean)).size,
      averageConfidence: evidence.length ? Number((evidence.reduce((a, e) => a + Number(e.confidence || 0), 0) / evidence.length).toFixed(3)) : 0
    },
    recommendation: run.recommendation || null,
    report: run.report || null,
    createdAt: run.created_at,
    updatedAt: run.updated_at
  };
}

function findRun(token) {
  if (!token) return null;
  const wanted = hash(token);
  const run = Object.values(load().runs).find(r => r.access_token_hash === wanted);
  if (!run) return null;
  if (run.token_expires_at && new Date(run.token_expires_at) <= new Date()) return null;
  return run;
}

function newRun({ goal, mode, plan, preferences, parent = null, revision = 1, token }) {
  const db = load();
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const prefs = normalizePreferences(preferences);
  const expires = new Date(Date.now() + 7 * 86400000).toISOString();
  const hasPrefs = prefs.minSalary || prefs.targetLocations.length || prefs.requiredKeywords.length || prefs.workMode !== 'any';
  const run = {
    id,
    actor_id: 'guest',
    goal,
    goal_snapshot: goal,
    mode,
    state: 'created',
    paused_from: null,
    parent_run_id: parent?.id || null,
    revision,
    plan,
    preferences: prefs,
    preferences_expires_at: hasPrefs ? expires : null,
    access_token_hash: hash(token),
    token_expires_at: expires,
    recommendation: null,
    report: null,
    created_at: timestamp,
    updated_at: timestamp
  };
  db.runs[id] = run;
  db.tasks[id] = [];
  return run;
}

function normalizePreferences(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const minSalary = Number(raw.minSalary);
  return {
    minSalary: Number.isFinite(minSalary) && minSalary > 0 ? minSalary : null,
    targetLocations: Array.isArray(raw.targetLocations) ? raw.targetLocations.map(x => clean(x, 120)).filter(Boolean).slice(0, 20) : [],
    requiredKeywords: Array.isArray(raw.requiredKeywords) ? raw.requiredKeywords.map(x => clean(x, 120)).filter(Boolean).slice(0, 30) : [],
    workMode: ['any', 'onsite', 'hybrid', 'remote'].includes(raw.workMode) ? raw.workMode : 'any'
  };
}

function createRun(body) {
  const goal = clean(body.goal);
  if (!goal) throw fail('INVALID_GOAL', 400);
  const mode = ['cheap', 'balanced', 'quality', 'maximum'].includes(body.mode) ? body.mode : 'balanced';
  const plan = body.plan && typeof body.plan === 'object' ? body.plan : { version: '1.0', tasks: [] };
  const token = makeToken();
  const run = newRun({ goal, mode, plan, preferences: body.preferences, token });
  const db = load();
  db.tasks[run.id] = (Array.isArray(plan.tasks) ? plan.tasks : []).map(t => ({
    run_id: run.id,
    task_key: clean(t.id, 120),
    task_type: clean(t.type, 80),
    query: clean(t.query, 2000),
    status: 'pending',
    depends_on: Array.isArray(t.dependsOn) ? t.dependsOn : [],
    attempts: 0,
    last_error: null
  }));
  persist();
  return { status: 201, payload: { run: materialize(run), accessToken: token } };
}

function snapshot(run) {
  const db = load();
  const evidence = db.evidence.filter(e => e.run_id === run.id)
    .map(e => ({ id: e.id, source_id: e.source_id, claim: e.claim, status: e.status, confidence: e.confidence, provenance: e.provenance, retrieved_at: e.retrieved_at }));
  const opportunities = db.opportunities.filter(o => o.run_id === run.id);
  const postings = db.postings.filter(p => opportunities.some(o => o.id === p.opportunity_id));

  // Run-scoped sources and documents: a guest token must never disclose another
  // session's retrieval trail.
  const sourceIds = new Set([
    ...evidence.map(e => e.source_id),
    ...postings.map(p => p.source_id),
    ...db.documents.filter(d => d.run_id === run.id).map(d => d.source_id)
  ].filter(Boolean));
  const sources = db.sources.filter(s => sourceIds.has(s.id))
    .map(s => ({ id: s.id, canonical_url: s.canonical_url, source_type: s.source_type, reliability: s.reliability, metadata: s.metadata }));
  const documents = db.documents.filter(d => d.run_id === run.id)
    .map(d => ({ id: d.id, source_id: d.source_id, canonical_url: d.canonical_url, title: d.title, content_type: d.content_type, content_hash: d.content_hash, retrieval_method: d.retrieval_method, retrieved_at: d.retrieved_at, metadata: d.metadata }));

  return { run: materialize(run), evidence, sources, opportunities, postings, documents };
}

function transition(run, body) {
  let target = clean(body.target, 40);
  if (target === 'resume' && run.state === 'paused') target = run.paused_from || 'planning';
  if (!STATES.has(target) || !(EDGES.get(run.state) || new Set()).has(target)) {
    throw fail('INVALID_STATE_TRANSITION', 409);
  }
  if (target === 'paused') run.paused_from = run.state;
  if (run.state === 'paused' && target !== 'paused') run.paused_from = null;
  run.state = target;
  run.updated_at = nowIso();
  persist();
  return { payload: { run: materialize(run) } };
}

function taskOp(run, body) {
  const db = load();
  const list = db.tasks[run.id] || (db.tasks[run.id] = []);
  const key = clean(body.taskKey, 120);
  let task = list.find(t => t.task_key === key);
  if (!task && body.createIfMissing) {
    task = {
      run_id: run.id,
      task_key: key,
      task_type: clean(body.taskType || 'search', 80),
      query: clean(body.query || '', 2000),
      status: clean(body.status || 'pending', 30),
      depends_on: [],
      attempts: Number(body.attempts || 0),
      last_error: null
    };
    list.push(task);
  }
  if (task) {
    if (body.status) task.status = clean(body.status, 30);
    if (body.status === 'running') task.attempts = Number(body.attempts || 0) + 1;
    else if (body.attempts !== undefined) task.attempts = Number(body.attempts || 0);
    if (body.error) task.last_error = clean(body.error, 1000);
  }
  persist();
  return { payload: { task: task || null } };
}

function ingest(run, body) {
  if (JSON.stringify(body).length > MAX_PAYLOAD) throw fail('PAYLOAD_TOO_LARGE', 413);
  const db = load();
  const sourceMap = {};

  for (const input of (Array.isArray(body.sources) ? body.sources : []).slice(0, 20)) {
    const url = clean(input.canonical_url, 500);
    if (!url) continue;
    let row = db.sources.find(s => s.canonical_url === url);
    if (row) {
      row.last_seen_at = nowIso();
      row.reliability = Number(input.reliability ?? row.reliability ?? 0.5);
      row.metadata = input.metadata || row.metadata || {};
    } else {
      row = {
        id: crypto.randomUUID(),
        canonical_url: url,
        source_type: clean(input.source_type, 80),
        reliability: Number(input.reliability ?? 0.5),
        first_seen_at: nowIso(),
        last_seen_at: nowIso(),
        metadata: input.metadata || {}
      };
      db.sources.push(row);
    }
    sourceMap[input.sourceKey || input.metadata?.provider || url] = row.id;
  }

  for (const document of (Array.isArray(body.documents) ? body.documents : []).slice(0, 50)) {
    const url = clean(document.url, 500);
    if (!url) continue;
    const contentHash = clean(document.contentHash, 128);
    const content = String(document.content || '').slice(0, 1000000);
    const existing = db.documents.find(d => d.canonical_url === url && d.content_hash === contentHash);
    if (existing) continue;
    db.documents.push({
      id: crypto.randomUUID(),
      run_id: run.id,
      source_id: sourceMap[document.sourceId] || null,
      canonical_url: url,
      title: clean(document.title, 500),
      content_type: clean(document.contentType, 120),
      content_hash: contentHash,
      content,
      retrieval_method: clean(document.retrievalMethod || 'http', 80),
      retrieved_at: document.retrievedAt || nowIso(),
      metadata: document.metadata || {}
    });
  }

  for (const job of (Array.isArray(body.jobs) ? body.jobs : []).slice(0, 150)) {
    const key = clean(job.canonicalKey, 500);
    if (!key) continue;
    let opportunity = db.opportunities.find(o => o.run_id === run.id && o.canonical_key === key);
    const fields = {
      title: clean(job.title, 500),
      company: clean(job.company, 500),
      location: clean(job.location, 500),
      salary: job.salary ?? null,
      requirements: job.requirements || [],
      benefits: job.benefits || [],
      employment: job.employment || {},
      risk: job.risk ?? null,
      decision_score: job.decisionScore ?? null,
      objective_score: job.objectiveScore ?? null,
      data_quality: job.dataQuality ?? null,
      risk_flags: job.riskFlags || [],
      fit: job.fit ?? null,
      financial: job.financial || {},
      career: job.career || {},
      decision_components: job.decisionComponents || {},
      opportunity_cost: job.opportunityCost ?? null
    };
    if (!opportunity) {
      opportunity = { id: crypto.randomUUID(), run_id: run.id, canonical_key: key, created_at: nowIso(), ...fields };
      db.opportunities.push(opportunity);
    } else {
      Object.assign(opportunity, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== undefined)));
    }
    const postingUrl = clean(job.url, 500);
    if (postingUrl && !db.postings.some(p => p.opportunity_id === opportunity.id && p.canonical_url === postingUrl)) {
      db.postings.push({
        id: crypto.randomUUID(),
        opportunity_id: opportunity.id,
        source_id: sourceMap[job.sourceId] || null,
        canonical_url: postingUrl,
        raw_data: job.rawData || {},
        retrieved_at: job.retrievedAt || nowIso()
      });
    }
  }

  for (const item of (Array.isArray(body.evidence) ? body.evidence : []).slice(0, 400)) {
    const requested = ALLOWED_EVIDENCE.has(item.status) ? item.status : 'reported';
    const provenance = item.provenance && typeof item.provenance === 'object' ? item.provenance : {};
    const trusted = requested === 'verified_fact'
      && provenance.verificationMethod === 'cross_source_core_v1'
      && Array.isArray(provenance.independentSources)
      && provenance.independentSources.length >= 2;
    db.evidence.push({
      id: crypto.randomUUID(),
      run_id: run.id,
      source_id: sourceMap[item.sourceId] || null,
      claim: clean(item.claim, 2000),
      status: trusted ? 'verified_fact' : (requested === 'verified_fact' ? 'reported' : requested),
      confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0))),
      provenance,
      retrieved_at: item.retrievedAt || nowIso()
    });
  }

  if (body.recommendation || body.report) {
    if (body.recommendation) run.recommendation = body.recommendation;
    if (body.report) run.report = body.report;
    run.updated_at = nowIso();
  }
  persist();
  return { payload: { run: materialize(run) } };
}

function compare(run, body) {
  const db = load();
  const other = findRun(clean(body.otherToken, 300));
  if (!other) throw fail('OTHER_RUN_UNAUTHORIZED', 401);
  const left = db.opportunities.filter(o => o.run_id === run.id);
  const right = db.opportunities.filter(o => o.run_id === other.id);
  const keys = [...new Set([...left.map(o => o.canonical_key), ...right.map(o => o.canonical_key)])];
  return {
    payload: {
      left: { id: run.id, state: run.state, evidenceScore: run.report?.evidenceScore?.score ?? null, opportunities: left.length },
      right: { id: other.id, state: other.state, evidenceScore: other.report?.evidenceScore?.score ?? null, opportunities: right.length },
      opportunityDiff: keys.map(key => ({
        canonicalKey: key,
        left: left.find(o => o.canonical_key === key) || null,
        right: right.find(o => o.canonical_key === key) || null
      }))
    }
  };
}

function branch(run, body) {
  const db = load();
  if (body.op === 'retry' && run.state !== 'failed') throw fail('RETRY_REQUIRES_FAILED_RUN', 409);
  const token = makeToken();
  const child = newRun({
    goal: run.goal,
    mode: run.mode,
    plan: run.plan,
    preferences: body.preferences || run.preferences,
    parent: run,
    revision: (run.revision || 1) + 1,
    token
  });
  db.tasks[child.id] = (db.tasks[run.id] || []).map(t => ({ ...t, run_id: child.id, status: 'pending', attempts: 0, last_error: null }));
  persist();
  return { status: 201, payload: { run: materialize(child), accessToken: token } };
}

function localControlRequest(body = {}, token = '') {
  const db = load();
  if (body.op === 'create') return createRun(body);

  const run = findRun(token);
  if (!run) throw fail('UNAUTHORIZED', 401);

  switch (body.op) {
    case 'get':
      return { payload: { run: materialize(run) } };
    case 'snapshot':
      return { payload: snapshot(run) };
    case 'transition':
      return transition(run, body);
    case 'task':
      return taskOp(run, body);
    case 'ingest':
      return ingest(run, body);
    case 'compare':
      return compare(run, body);
    case 'fork':
    case 'replay':
    case 'retry':
      return branch(run, body);
    case 'revoke': {
      run.access_token_hash = null;
      run.token_expires_at = nowIso();
      run.updated_at = nowIso();
      persist();
      return { payload: { ok: true } };
    }
    default:
      throw fail('UNKNOWN_OPERATION', 400);
  }
}

module.exports = { localControlRequest, reset, STORE_PATH };
