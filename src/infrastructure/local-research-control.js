'use strict';

/*
 * In-process control plane.
 *
 * This is a faithful local mirror of the deployed Supabase Edge Function
 * (`supabase/functions/research-control/index.ts`): the same operations, payload
 * shapes, error codes and state-machine edges, plus the same run-scoped snapshots,
 * hashed opaque tokens and evidence gate. It exists so `npm start`, the test suite
 * and `scripts/check-control-plane.js` exercise the production contract without a
 * cloud project; production always uses the Edge Function.
 *
 * Guarded by test/control-plane-parity.test.js.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TRANSITIONS } = require('../domain/research/research-run');
const { sanitizeEvidenceStatus } = require('../domain/research/evidence-policy');

const STORE_PATH = process.env.JOBSCOPE_LOCAL_STORE || path.join(os.tmpdir(), 'jobscope-local-control.json');
const WINDOW_MS = 60 * 1000;
const MAX_CREATE_PER_WINDOW = 5;
const MAX_PROTECTED_PER_WINDOW = 180;
const MAX_INGEST_BYTES = 2500000;
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RUN_VERSION = '1.3';
const MODES = new Set(['cheap', 'balanced', 'quality', 'maximum']);
const WORK_MODES = new Set(['any', 'onsite', 'hybrid', 'remote']);
const RELATIONS = new Set(['supports', 'contradicts', 'corroborates', 'duplicates']);

// Same helper as the Edge Function: trim, collapse whitespace, cap length.
const clean = (value, max = 2000) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const nowIso = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const hashToken = token => crypto.createHash('sha256').update(String(token)).digest('hex');
const makeToken = () => crypto.randomBytes(32).toString('base64url');

function fail(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function emptyState() {
  return {
    runs: [],
    tasks: [],
    sources: [],
    documents: [],
    evidence: [],
    relations: [],
    opportunities: [],
    postings: [],
    events: [],
    createWrites: []
  };
}

let cache = null;

// A store written by an older build may key runs by id (object) instead of an
// array, or miss collections entirely. Normalise instead of crashing.
function normalizeStore(raw) {
  const state = Object.assign(emptyState(), raw && typeof raw === 'object' ? raw : {});
  if (!Array.isArray(state.runs)) {
    state.runs = state.runs && typeof state.runs === 'object' ? Object.values(state.runs) : [];
  }
  for (const key of Object.keys(emptyState())) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  return state;
}

function load() {
  if (cache) return cache;
  try {
    cache = normalizeStore(JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')));
  } catch {
    cache = emptyState();
  }
  return cache;
}

// Re-read the store from disk (used after an external write, e.g. a migration).
function reload() {
  cache = null;
  return load();
}

function save() {
  if (!cache) return;
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(cache));
  } catch {
    // A read-only filesystem must never break execution.
  }
}

// Tests create many runs from one process; production keys the limit per visitor.
function resetLimits() {
  createLimits.clear();
  protectedLimits.clear();
}

function reset() {
  cache = emptyState();
  createLimits.clear();
  protectedLimits.clear();
  save();
}

function bucket(map, key, limit) {
  const now = Date.now();
  const entry = map.get(key) || { at: now, count: 0 };
  if (now - entry.at >= WINDOW_MS) {
    entry.at = now;
    entry.count = 0;
  }
  entry.count += 1;
  map.set(key, entry);
  if (map.size > 10000) map.clear();
  return entry.count > limit;
}

const createLimits = new Map();
const protectedLimits = new Map();

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

function tasksFor(runId) {
  return load().tasks.filter(task => task.run_id === runId);
}

function findRun(id) {
  return load().runs.find(run => run.id === id) || null;
}

function findRunByToken(token) {
  if (!token) return null;
  const hash = hashToken(token);
  return load().runs.find(run => run.access_token_hash && run.access_token_hash === hash) || null;
}

function preferencesOf(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const minSalary = Number(source.minSalary);
  const preferences = {
    minSalary: minSalary > 0 ? minSalary : null,
    targetLocations: Array.isArray(source.targetLocations)
      ? source.targetLocations.map(item => clean(item, 120)).filter(Boolean).slice(0, 20)
      : [],
    requiredKeywords: Array.isArray(source.requiredKeywords)
      ? source.requiredKeywords.map(item => clean(item, 120)).filter(Boolean).slice(0, 30)
      : [],
    workMode: WORK_MODES.has(source.workMode) ? source.workMode : 'any'
  };
  const meaningful = preferences.minSalary
    || preferences.targetLocations.length
    || preferences.requiredKeywords.length
    || preferences.workMode !== 'any';
  return { preferences, meaningful };
}

function insertRun({ goal, mode, plan, preferences, parentRunId = null, state = 'created', revision = 1 }) {
  const state_ = load();
  const timestamp = nowIso();
  const run = {
    id: newId(),
    actor_id: 'guest',
    goal,
    goal_snapshot: goal,
    mode,
    state,
    plan,
    preferences,
    preferences_expires_at: null,
    access_token_hash: null,
    token_expires_at: null,
    paused_from: null,
    parent_run_id: parentRunId,
    revision,
    recommendation: null,
    report: null,
    created_at: timestamp,
    updated_at: timestamp
  };
  state_.runs.push(run);
  return run;
}

function issueToken(run) {
  const access = makeToken();
  run.access_token_hash = hashToken(access);
  run.token_expires_at = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  return access;
}

function seedTasks(run, tasks) {
  const state = load();
  for (const task of tasks) {
    if (!task) continue;
    state.tasks.push({
      id: newId(),
      run_id: run.id,
      task_key: clean(task.id, 120),
      task_type: clean(task.type, 80),
      query: clean(task.query, 2000),
      status: 'pending',
      depends_on: Array.isArray(task.dependsOn) ? task.dependsOn : [],
      attempts: 0,
      started_at: null,
      completed_at: null,
      last_error: null
    });
  }
}

function logEvent(runId, eventType, state, payload) {
  load().events.push({ id: newId(), run_id: runId, event_type: eventType, state, payload, created_at: nowIso() });
}

// ---------------------------------------------------------------------------
// Snapshots (run-scoped, exactly like the Edge Function)
// ---------------------------------------------------------------------------

function evidenceSummary(runId) {
  const evidence = load().evidence.filter(row => row.run_id === runId);
  const byStatus = { verified_fact: 0, reported: 0, estimated: 0, inferred: 0, unknown: 0, conflicting: 0 };
  for (const row of evidence) byStatus[row.status] = (byStatus[row.status] || 0) + 1;
  return {
    total: evidence.length,
    byStatus,
    sourceCount: new Set(evidence.map(row => row.source_id).filter(Boolean)).size,
    averageConfidence: evidence.length
      ? Number((evidence.reduce((sum, row) => sum + Number(row.confidence || 0), 0) / evidence.length).toFixed(3))
      : 0
  };
}

const OPPORTUNITY_FIELDS = [
  'canonical_key', 'title', 'company', 'location', 'salary', 'requirements', 'benefits', 'employment',
  'fit', 'risk', 'decision_score', 'data_quality', 'risk_flags', 'financial', 'career',
  'decision_components', 'opportunity_cost'
];

function pickOpportunity(row) {
  const picked = { id: row.id };
  for (const field of OPPORTUNITY_FIELDS) picked[field] = row[field] ?? null;
  return picked;
}

function materialize(run) {
  const state = load();
  const tasks = tasksFor(run.id).map(task => ({
    task_key: task.task_key,
    task_type: task.task_type,
    query: task.query,
    status: task.status,
    depends_on: task.depends_on,
    attempts: task.attempts,
    last_error: task.last_error,
    started_at: task.started_at,
    completed_at: task.completed_at
  }));
  const opportunities = state.opportunities
    .filter(row => row.run_id === run.id)
    .map(pickOpportunity)
    .sort((a, b) => Number(b.decision_score ?? -1) - Number(a.decision_score ?? -1));
  const preferencesExpired = run.preferences_expires_at && new Date(run.preferences_expires_at) <= new Date();
  return {
    id: run.id,
    type: 'research_run',
    version: RUN_VERSION,
    actorId: run.actor_id,
    goal: run.goal,
    goalSnapshot: run.goal_snapshot,
    mode: run.mode,
    state: run.state,
    pausedFrom: run.paused_from || null,
    parentRunId: run.parent_run_id || null,
    revision: run.revision || 1,
    preferences: preferencesExpired ? {} : (run.preferences || {}),
    plan: run.plan,
    tasks,
    opportunities,
    evidenceSummary: evidenceSummary(run.id),
    recommendation: run.recommendation,
    report: run.report,
    createdAt: run.created_at,
    updatedAt: run.updated_at
  };
}

function snapshotPayload(run) {
  const state = load();
  const evidence = state.evidence
    .filter(row => row.run_id === run.id)
    .map(row => ({
      id: row.id,
      source_id: row.source_id,
      claim: row.claim,
      status: row.status,
      confidence: row.confidence,
      provenance: row.provenance,
      retrieved_at: row.retrieved_at
    }));
  const opportunities = state.opportunities.filter(row => row.run_id === run.id).map(pickOpportunity);
  const opportunityIds = new Set(opportunities.map(row => row.id));
  const postings = state.postings.filter(row => opportunityIds.has(row.opportunity_id));
  const documents = state.documents
    .filter(row => row.run_id === run.id)
    .slice(0, 100)
    .map(row => ({
      id: row.id,
      source_id: row.source_id,
      canonical_url: row.canonical_url,
      title: row.title,
      content_type: row.content_type,
      content_hash: row.content_hash,
      retrieval_method: row.retrieval_method,
      retrieved_at: row.retrieved_at,
      metadata: row.metadata
    }));
  const sourceIds = [...new Set([
    ...evidence.map(row => row.source_id),
    ...postings.map(row => row.source_id),
    ...documents.map(row => row.source_id)
  ].filter(Boolean))];
  const sources = state.sources
    .filter(row => sourceIds.includes(row.id))
    .map(row => ({
      id: row.id,
      canonical_url: row.canonical_url,
      source_type: row.source_type,
      reliability: row.reliability,
      metadata: row.metadata
    }));
  return { run: materialize(run), evidence, sources, opportunities, postings, documents };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

function create(body, clientIp = 'local') {
  if (bucket(createLimits, clientIp, MAX_CREATE_PER_WINDOW)) {
    throw fail('RATE_LIMITED', 'too many runs created in the last minute', 429);
  }
  const goal = clean(body?.goal);
  if (!goal) throw fail('INVALID_GOAL', 'a research goal is required', 400);
  const mode = MODES.has(body?.mode) ? body.mode : 'balanced';
  const plan = body?.plan && typeof body.plan === 'object' ? body.plan : { version: '1.0', tasks: [] };
  const { preferences, meaningful } = preferencesOf(body?.preferences);

  const run = insertRun({ goal, mode, plan, preferences });
  if (meaningful) run.preferences_expires_at = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const accessToken = issueToken(run);
  seedTasks(run, Array.isArray(plan.tasks) ? plan.tasks : []);
  logEvent(run.id, 'run.created', 'created', { actor: 'guest', mode });
  save();
  return { status: 201, payload: { run: materialize(run), accessToken } };
}

function authorize(token) {
  if (bucket(protectedLimits, 'p:' + String(token).slice(0, 80), MAX_PROTECTED_PER_WINDOW)) {
    throw fail('RATE_LIMITED', 'too many control-plane calls for this token', 429);
  }
  const run = findRunByToken(token);
  if (!run || !run.access_token_hash || new Date(run.token_expires_at) <= new Date()) {
    throw fail('UNAUTHORIZED', 'unknown, expired or revoked access token', 401);
  }
  return run;
}

function transition(run, requested) {
  let target = clean(requested, 40);
  if (target === 'resume' && run.state === 'paused') target = run.paused_from || 'planning';
  const allowed = TRANSITIONS[run.state] || [];
  if (!allowed.includes(target)) {
    throw fail('INVALID_STATE_TRANSITION', `${run.state} -> ${target}`, 409);
  }
  run.paused_from = target === 'paused' ? run.state : (run.state === 'paused' && target !== 'paused' ? null : run.paused_from);
  run.state = target;
  run.updated_at = nowIso();
  logEvent(run.id, 'run.state_changed', target, { previousState: run.state });
  save();
  return { status: 200, payload: { run: materialize(run) } };
}

function taskUpdate(run, body) {
  const key = clean(body?.taskKey, 120);
  const status = clean(body?.status, 30);
  let task = tasksFor(run.id).find(row => row.task_key === key) || null;
  if (!task && body?.createIfMissing) {
    task = {
      id: newId(),
      run_id: run.id,
      task_key: key,
      task_type: clean(body.taskType || 'search', 80),
      query: clean(body.query || '', 2000),
      status,
      depends_on: Array.isArray(body.dependsOn) ? body.dependsOn : [],
      attempts: Number(body.attempts || 0),
      started_at: null,
      completed_at: null,
      last_error: null
    };
    load().tasks.push(task);
  }
  if (!task) throw fail('TASK_NOT_FOUND', `unknown task: ${key}`, 404);
  task.status = status;
  if (status === 'running') {
    task.started_at = nowIso();
    task.attempts = Number(body.attempts || 0) + 1;
  }
  if (['completed', 'failed'].includes(status)) task.completed_at = nowIso();
  if (body?.error) task.last_error = clean(body.error, 1000);
  run.updated_at = nowIso();
  save();
  return { status: 200, payload: { task } };
}

function ingestSources(run, rows) {
  const state = load();
  const map = {};
  for (const source of (rows || []).slice(0, 20)) {
    const url = clean(source.canonical_url, 500);
    if (!url) continue;
    let record = state.sources.find(row => row.canonical_url === url) || null;
    if (record) {
      record.last_seen_at = nowIso();
      record.reliability = Number(source.reliability ?? record.reliability ?? 0.5);
      record.metadata = source.metadata || record.metadata || {};
    } else {
      record = {
        id: newId(),
        canonical_url: url,
        source_type: clean(source.source_type, 80),
        reliability: Number(source.reliability ?? 0.5),
        metadata: source.metadata || {},
        first_seen_at: nowIso(),
        last_seen_at: nowIso()
      };
      state.sources.push(record);
    }
    map[source.sourceKey || source.metadata?.provider || url] = record.id;
  }
  return map;
}

function ingest(run, body) {
  if (JSON.stringify(body).length > MAX_INGEST_BYTES) {
    throw fail('PAYLOAD_TOO_LARGE', 'ingest payload is too large', 413);
  }
  const state = load();
  const documents = Array.isArray(body.documents) ? body.documents.slice(0, 50) : [];
  const jobs = Array.isArray(body.jobs) ? body.jobs.slice(0, 150) : [];
  const evidence = Array.isArray(body.evidence) ? body.evidence.slice(0, 400) : [];
  const sourceMap = ingestSources(run, body.sources);

  for (const document of documents) {
    state.documents.push({
      id: newId(),
      run_id: run.id,
      source_id: sourceMap[document.sourceId] || null,
      canonical_url: clean(document.url, 500),
      title: clean(document.title, 500),
      content_type: clean(document.contentType, 120),
      content_hash: clean(document.contentHash, 128),
      content: String(document.content || '').slice(0, 1000000),
      retrieval_method: clean(document.retrievalMethod || 'http', 80),
      retrieved_at: document.retrievedAt || nowIso(),
      metadata: document.metadata || {}
    });
  }

  for (const job of jobs) {
    const key = clean(job.canonicalKey, 500);
    if (!key) continue;
    let opportunity = state.opportunities.find(row => row.run_id === run.id && row.canonical_key === key) || null;
    const fields = {
      title: clean(job.title, 500),
      company: clean(job.company, 500),
      location: clean(job.location, 500),
      salary: job.salary ?? null,
      requirements: job.requirements || [],
      benefits: job.benefits || [],
      employment: job.employment || {},
      fit: job.fit ?? null,
      risk: job.risk ?? null,
      decision_score: job.decisionScore ?? null,
      data_quality: job.dataQuality ?? null,
      risk_flags: job.riskFlags || [],
      financial: job.financial || {},
      career: job.career || {},
      decision_components: job.decisionComponents || {},
      opportunity_cost: job.opportunityCost ?? null,
      updated_at: nowIso()
    };
    if (opportunity) {
      for (const [field, value] of Object.entries(fields)) {
        if (value !== null && value !== undefined && !(Array.isArray(value) && !value.length)) opportunity[field] = value;
      }
    } else {
      opportunity = { id: newId(), run_id: run.id, canonical_key: key, created_at: nowIso(), ...fields };
      state.opportunities.push(opportunity);
    }
    if (job.url) {
      state.postings.push({
        id: newId(),
        opportunity_id: opportunity.id,
        source_id: sourceMap[job.sourceId] || null,
        canonical_url: clean(job.url, 500),
        raw_data: job.rawData || {},
        retrieved_at: job.retrievedAt || nowIso()
      });
    }
  }

  const inserted = [];
  for (const row of evidence) {
    const provenance = row.provenance && typeof row.provenance === 'object' ? row.provenance : {};
    const record = {
      id: newId(),
      run_id: run.id,
      source_id: sourceMap[row.sourceId] || null,
      claim: clean(row.claim, 2000),
      // The same gate the Edge Function applies.
      status: sanitizeEvidenceStatus(row.status, provenance),
      confidence: Number(Math.max(0, Math.min(1, row.confidence ?? 0))),
      provenance,
      retrieved_at: row.retrievedAt || nowIso()
    };
    state.evidence.push(record);
    inserted.push(record);
  }

  const relations = Array.isArray(body.relations) ? body.relations.slice(0, 500) : [];
  if (relations.length) {
    const byKey = new Map(inserted
      .filter(record => record.provenance?.evidenceKey)
      .map(record => [record.provenance.evidenceKey, record.id]));
    for (const relation of relations) {
      const from = byKey.get(relation.evidenceKey);
      const to = byKey.get(relation.relatedEvidenceKey);
      if (!from || !to || !RELATIONS.has(relation.relation)) continue;
      state.relations.push({ id: newId(), run_id: run.id, evidence_id: from, related_evidence_id: to, relation: relation.relation });
    }
  }

  if (body.recommendation || body.report) {
    run.recommendation = body.recommendation || run.recommendation;
    run.report = body.report || run.report;
  }
  run.updated_at = nowIso();
  logEvent(run.id, 'research.ingested', run.state, {
    sources: (body.sources || []).length,
    documents: documents.length,
    jobs: jobs.length,
    evidence: evidence.length,
    relations: relations.length
  });
  save();
  return { status: 200, payload: { run: materialize(run) } };
}

function revoke(run) {
  run.access_token_hash = null;
  run.token_expires_at = nowIso();
  run.updated_at = nowIso();
  save();
  return { status: 200, payload: { ok: true } };
}

function spawnChild(run, op, preferences) {
  const { preferences: prefs, meaningful } = preferencesOf(preferences);
  const child = insertRun({
    goal: run.goal,
    mode: run.mode,
    plan: run.plan,
    preferences: Object.keys(prefs).length ? prefs : run.preferences,
    parentRunId: run.id,
    revision: (run.revision || 1) + 1
  });
  if (meaningful || run.preferences_expires_at) child.preferences_expires_at = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const accessToken = issueToken(child);
  for (const task of tasksFor(run.id)) {
    load().tasks.push({
      id: newId(),
      run_id: child.id,
      task_key: task.task_key,
      task_type: task.task_type,
      query: task.query,
      status: 'pending',
      depends_on: task.depends_on || [],
      attempts: 0,
      started_at: null,
      completed_at: null,
      last_error: null
    });
  }
  logEvent(child.id, 'run.created', 'created', { actor: 'guest', parentRunId: run.id, reason: op });
  save();
  return { status: 201, payload: { run: materialize(child), accessToken } };
}

function compare(run, otherToken) {
  const other = findRunByToken(clean(otherToken, 300));
  if (!other) throw fail('OTHER_RUN_UNAUTHORIZED', 'the comparison token is unknown, expired or revoked', 401);
  const left = materialize(run);
  const right = materialize(other);
  const leftOps = new Map(left.opportunities.map(row => [row.canonical_key, row]));
  const rightOps = new Map(right.opportunities.map(row => [row.canonical_key, row]));
  const keys = [...new Set([...leftOps.keys(), ...rightOps.keys()])];
  const row = (source, id, state, opportunities) => ({
    id,
    state,
    evidenceScore: source.report?.evidenceScore || null,
    opportunities: opportunities.length
  });
  return {
    status: 200,
    payload: {
      left: row(run, run.id, run.state, left.opportunities),
      right: row(other, other.id, other.state, right.opportunities),
      opportunityDiff: keys.map(key => ({
        canonicalKey: key,
        left: leftOps.get(key) || null,
        right: rightOps.get(key) || null
      }))
    }
  };
}

// ---------------------------------------------------------------------------
// Dispatch (identical operation surface to the Edge Function)
// ---------------------------------------------------------------------------

function localControlRequest(body, token, meta = {}) {
  const op = clean(body?.op, 40);
  if (op === 'create') return create(body, meta.ip || 'local');
  const run = authorize(clean(token, 300));
  switch (op) {
    case 'get':
      return { status: 200, payload: { run: materialize(run) } };
    case 'snapshot':
      return { status: 200, payload: snapshotPayload(run) };
    case 'transition':
      return transition(run, body.target);
    case 'task':
      return taskUpdate(run, body);
    case 'ingest':
      return ingest(run, body);
    case 'revoke':
      return revoke(run);
    case 'compare':
      return compare(run, body.otherToken);
    case 'fork':
      return spawnChild(run, 'fork', body.preferences);
    case 'replay':
      return spawnChild(run, 'replay', body.preferences);
    case 'retry':
      if (run.state !== 'failed') throw fail('RETRY_REQUIRES_FAILED_RUN', 'only a failed run can be retried', 409);
      return spawnChild(run, 'retry', body.preferences);
    default:
      throw fail('UNKNOWN_OPERATION', `unsupported control-plane operation: ${op || '(none)'}`, 400);
  }
}

module.exports = {
  localControlRequest,
  reload,
  resetLimits,
  materialize,
  snapshotPayload,
  hashToken,
  reset,
  STORE_PATH,
  RUN_VERSION
};
