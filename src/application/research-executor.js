'use strict';
const { call } = require('../infrastructure/research-control-client');
const { searchJobs } = require('./search-service');
const { searchWeb } = require('./generic-web-search');
const { scoreEvidence } = require('../domain/research/scoring');
const { buildRecommendation } = require('../domain/research/recommendation');
const { buildReport } = require('../domain/research/report');
const { scoreOpportunity } = require('../domain/research/opportunity-scoring');
const { scorePersonalFit } = require('../domain/research/profile-scoring');
const { evaluateOpportunities } = require('../domain/research/decision-engine');
const { detectGaps, buildExpansionQueries } = require('../domain/research/gap-detection');

const SEARCH_TYPES = new Set(['search', 'search_web']);
const TERMINAL_STATES = ['completed', 'cancelled', 'failed'];
const DEFAULT_EXPANSION_ROUNDS = 1;
const DEFAULT_EXPANSION_TASKS = 3;
const MAX_EXPANSION_ROUNDS = 2;
const MAX_EXPANSION_TASKS = 6;
const GAP_MARKER = /^gapsig_(\d+)_(.+)$/;

function providerFor(task, domain) {
  if (domain !== 'jobs' && task.task_key === 'search_web') return 'duckduckgo';
  if (task.task_key === 'search_wuzzuf' || /_(wuzzuf)$/.test(task.task_key)) return 'wuzzuf';
  if (task.task_key === 'search_forasna' || /_(forasna)$/.test(task.task_key)) return 'forasna';
  return null;
}

/* ------------------------------------------------------------------ *
 * Snapshot shaping
 * ------------------------------------------------------------------ */

function normalizeEvidenceRow(row = {}) {
  return {
    id: row.id ?? null,
    claim: row.claim ?? '',
    status: row.status ?? 'unknown',
    confidence: Number(row.confidence || 0),
    sourceId: row.source_id ?? row.sourceId ?? null,
    retrievedAt: row.retrieved_at ?? row.retrievedAt ?? null,
    provenance: row.provenance || {}
  };
}

function rebuildJobs(snapshot = {}) {
  const postings = Array.isArray(snapshot.postings) ? snapshot.postings : [];
  return (Array.isArray(snapshot.opportunities) ? snapshot.opportunities : []).map(opportunity => {
    const own = postings.filter(p => p.opportunity_id === opportunity.id);
    const sourceIds = [...new Set(own.map(p => p.source_id).filter(Boolean))];
    return {
      ...opportunity,
      canonicalKey: opportunity.canonical_key ?? opportunity.canonicalKey ?? null,
      sourceId: sourceIds[0] || null,
      sourceIds,
      url: own[0]?.canonical_url || null,
      sourceCount: sourceIds.length
    };
  });
}

function sourceKeyOf(row = {}) {
  return row?.metadata?.provider || row?.canonical_url || row?.id || null;
}

function expansionBounds(run) {
  const execution = run?.plan?.execution || {};
  const rounds = Number(execution.maxExpansionRounds);
  const tasks = Number(execution.maxExpansionTasks);
  return {
    maxRounds: Math.min(MAX_EXPANSION_ROUNDS, Math.max(0, Number.isFinite(rounds) ? rounds : DEFAULT_EXPANSION_ROUNDS)),
    maxTasks: Math.min(MAX_EXPANSION_TASKS, Math.max(1, Number.isFinite(tasks) ? tasks : DEFAULT_EXPANSION_TASKS))
  };
}

function gapSignature(gaps = []) {
  return [...new Set(gaps.map(g => g.type))].sort().join('+') || 'none';
}

function markerTasks(tasks = []) {
  return tasks
    .map(t => ({ task: t, match: String(t.task_key || '').match(GAP_MARKER) }))
    .filter(x => x.match)
    .map(x => ({ round: Number(x.match[1]), signature: x.match[2], task: x.task }));
}

function assessExpansion(run, snapshot) {
  const tasks = Array.isArray(run.tasks) ? run.tasks : [];
  const jobs = rebuildJobs(snapshot);
  const gaps = detectGaps({
    jobs,
    evidence: snapshot.evidence || [],
    sources: (snapshot.sources || []).map(s => ({ ...s, metadata: s.metadata || {} })),
    tasks
  });
  const { maxRounds, maxTasks } = expansionBounds(run);
  const expansionTasks = tasks.filter(t => /^expand_/.test(String(t.task_key || '')));
  const roundsDone = [...new Set(expansionTasks.map(t => Number((String(t.task_key).match(/^expand_(\d+)_/) || [])[1])).filter(Number.isFinite))];
  const nextRound = roundsDone.length ? Math.max(...roundsDone) + 1 : 1;
  const signature = gapSignature(gaps);
  const markers = markerTasks(tasks).sort((a, b) => a.round - b.round);
  const previous = markers[markers.length - 1] || null;
  const stagnant = Boolean(previous && previous.signature === signature);

  const queries = buildExpansionQueries(run.goal, run.plan?.intent?.location || '', gaps);
  let reason = 'ready';
  if (!gaps.length) reason = 'no_gaps';
  else if (!queries.length) reason = 'no_queries';
  else if (expansionTasks.length >= maxTasks) reason = 'expansion_task_budget_exhausted';
  else if (nextRound > maxRounds) reason = 'expansion_rounds_exhausted';
  else if (stagnant) reason = 'gaps_unchanged';

  const canExpand = reason === 'ready';
  return { gaps, signature, round: canExpand ? nextRound : null, queries: canExpand ? queries : [], reason, roundsDone: roundsDone.length, tasks: expansionTasks.length, nextRound, markerRound: markers.length + 1 };
}

/* ------------------------------------------------------------------ *
 * Search execution
 * ------------------------------------------------------------------ */

async function runSearchTask(run, task, token, search) {
  const provider = providerFor(task, run.plan?.domain || 'jobs');
  if (!provider) {
    await call({ op: 'task', taskKey: task.task_key, status: 'blocked_manual' }, { token });
    return 'blocked_manual';
  }
  await call({ op: 'task', taskKey: task.task_key, status: 'running', attempts: task.attempts || 0 }, { token });
  try {
    const location = run.plan?.intent?.location || '';
    const result = provider === 'duckduckgo'
      ? await search.web(task.query, { location, maxResults: 3 })
      : await search.jobs(task.query, { location, sourceIds: [provider] });
    await call({
      op: 'ingest',
      sources: result.sources || [],
      documents: result.documents || [],
      jobs: (result.jobs || []).map(j => ({ ...j, sourceKey: j.sourceId })),
      evidence: result.evidence || []
    }, { token });
    await call({ op: 'task', taskKey: task.task_key, status: 'completed' }, { token });
    return 'completed';
  } catch (error) {
    await call({ op: 'task', taskKey: task.task_key, status: 'failed', error: String(error.message || error) }, { token });
    return 'failed';
  }
}

/* ------------------------------------------------------------------ *
 * Finalization
 * ------------------------------------------------------------------ */

function buildEnrichedJobs(run, snapshot) {
  const jobs = rebuildJobs(snapshot);
  const evidence = (snapshot.evidence || []).map(normalizeEvidenceRow);
  const sources = Array.isArray(snapshot.sources) ? snapshot.sources : [];
  const enriched = jobs.map(job => {
    const evidenceForJob = evidence.filter(e => e.sourceId && e.sourceId === job.sourceId);
    const confidence = evidenceForJob.reduce((max, e) => Math.max(max, e.confidence), 0);
    const source = sources.find(s => s.id === job.sourceId);
    const objective = scoreOpportunity(job, {
      sourceReliability: Number(source?.reliability || 0.5),
      evidenceConfidence: confidence || Number(job.confidence || 0.5),
      independentSources: job.sourceCount || 1
    });
    const fit = run.plan?.domain === 'jobs' ? scorePersonalFit(job, run.preferences || {}) : null;
    return {
      ...job,
      objectiveScore: objective.score,
      dataQuality: objective.dataQuality,
      riskFlags: objective.riskFlags,
      fitScore: fit?.score ?? null,
      fitSignals: fit?.signals ?? [],
      sourceCount: job.sourceCount || 0
    };
  });
  return { jobs, evidence, sources, enriched };
}

async function finalizeRun(run, token) {
  const snapshot = await call({ op: 'snapshot' }, { token });
  const { jobs, evidence, sources, enriched } = buildEnrichedJobs(run, snapshot);

  const ranked = evaluateOpportunities(enriched)
    .map(item => ({
      ...item,
      decisionComponents: {
        objective: item.objectiveScore,
        fit: item.fitScore,
        financial: item.financialScore,
        career: item.careerProfile?.score ?? null,
        risk: item.riskProfile?.score ?? null,
        opportunityCost: item.opportunityCost,
        weights: item.decisionWeights
      }
    }));

  const verificationClaims = [];
  for (const job of jobs) {
    const independent = [...new Set(
      (snapshot.postings || [])
        .filter(p => p.opportunity_id === job.id)
        .map(p => p.source_id)
        .filter(Boolean)
    )];
    if (independent.length >= 2) {
      verificationClaims.push({
        claim: 'The same job opportunity is independently listed across ' + independent.length + ' sources: ' + (job.title || job.canonicalKey),
        sourceId: null,
        status: 'verified_fact',
        confidence: .9,
        provenance: {
          canonicalKey: job.canonicalKey,
          evidenceKey: 'verify-' + job.canonicalKey,
          verificationMethod: 'cross_source_core_v1',
          independentSources: independent
        }
      });
    }
  }
  if (verificationClaims.length) await call({ op: 'ingest', evidence: verificationClaims }, { token });

  const allEvidence = (await call({ op: 'snapshot' }, { token })).evidence?.map(normalizeEvidenceRow) || evidence;
  const sourceDiversity = new Set(allEvidence.map(e => e.sourceId).filter(Boolean)).size;
  const evidenceScore = scoreEvidence({ evidence: allEvidence, sourceDiversity });
  const best = ranked[0] || null;
  const recommendation = buildRecommendation({
    domain: run.plan?.domain || 'jobs',
    evidenceScore: evidenceScore.score,
    fitScore: best?.fitScore ?? null,
    opportunities: ranked
  });

  const assessment = assessExpansion(run, { ...snapshot, evidence: allEvidence });
  const stopping = {
    criterion: run.plan?.stopping?.criterion || 'evidence_sufficiency',
    reason: assessment.reason,
    expansionRounds: assessment.roundsDone,
    expansionTasks: assessment.tasks
  };
  const gaps = assessment.gaps;

  const report = buildReport({
    run: { id: run.id, goalSnapshot: run.goal, mode: run.mode },
    evidence: allEvidence,
    recommendation,
    opportunities: ranked,
    evidenceScore,
    gaps,
    stopping
  });
  report.execution = { mode: 'checkpointed', status: 'finalized', stopping: stopping.reason };

  const sourceIndex = new Map(sources.map(s => [s.id, sourceKeyOf(s)]));
  const ingestSources = sources
    .filter(s => s.id)
    .map(s => ({
      sourceKey: sourceKeyOf(s),
      canonical_url: s.canonical_url,
      source_type: s.source_type,
      reliability: s.reliability,
      metadata: s.metadata || {}
    }));

  await call({
    op: 'ingest',
    sources: ingestSources,
    jobs: ranked.map(item => ({
      canonicalKey: item.canonicalKey || item.canonical_key,
      title: item.title,
      company: item.company,
      location: item.location,
      salary: item.salary,
      requirements: item.requirements,
      benefits: item.benefits,
      employment: item.employment,
      url: item.url || null,
      sourceId: sourceIndex.get(item.sourceId) || item.sourceId || null,
      decisionScore: item.decisionScore,
      objectiveScore: item.objectiveScore,
      dataQuality: item.dataQuality,
      riskFlags: item.riskFlags,
      fit: item.fitScore === null ? null : { score: item.fitScore, signals: item.fitSignals },
      financial: item.financialProfile,
      career: item.careerProfile,
      decisionComponents: item.decisionComponents,
      opportunityCost: item.opportunityCost
    })),
    recommendation,
    report
  }, { token });

  let current = (await call({ op: 'snapshot' }, { token })).run;
  for (const [from, to] of [['searching', 'extracting'], ['extracting', 'verifying'], ['verifying', 'scoring'], ['scoring', 'reporting'], ['reporting', 'completed']]) {
    if (current?.state === from) current = (await call({ op: 'transition', target: to }, { token })).run;
  }

  return {
    status: 200,
    payload: {
      run: current,
      continue: false,
      phase: 'completed',
      evidenceScore,
      opportunityGroups: ranked.length,
      stopping,
      gaps
    }
  };
}

/* ------------------------------------------------------------------ *
 * Batch state machine
 * ------------------------------------------------------------------ */

// searchJobs/searchWeb are injectable so integration tests can drive the real
// batch state machine with deterministic provider output.
async function executeBatch(token, options = {}) {
  const search = { jobs: options.searchJobs || searchJobs, web: options.searchWeb || searchWeb };
  let run = (await call({ op: 'get' }, { token })).run;
  if (!run) return { status: 404, payload: { error: 'NOT_FOUND' } };
  if (TERMINAL_STATES.includes(run.state)) return { status: 200, payload: { run, continue: false, phase: run.state } };
  if (run.state === 'paused') return { status: 409, payload: { error: 'PAUSED_RUN' } };

  if (run.state === 'created') run = (await call({ op: 'transition', target: 'planning' }, { token })).run;
  if (run.state === 'planning') run = (await call({ op: 'transition', target: 'searching' }, { token })).run;

  const tasks = Array.isArray(run.tasks) ? run.tasks : [];
  const pendingSearch = tasks.find(t => t.status === 'pending' && (SEARCH_TYPES.has(t.task_type) || t.task_key === 'search_web'));
  if (pendingSearch) {
    await runSearchTask(run, pendingSearch, token, search);
    return { status: 200, payload: { run: (await call({ op: 'snapshot' }, { token })).run, continue: true, phase: 'searching' } };
  }

  const snapshot = await call({ op: 'snapshot' }, { token });
  run = snapshot.run;

  for (const task of run.tasks || []) {
    if (task.task_type === 'manual_research' && task.status === 'pending') {
      await call({ op: 'task', taskKey: task.task_key, status: 'blocked_manual' }, { token });
    }
  }

  const assessment = assessExpansion(run, snapshot);
  const hasPendingExpansion = (run.tasks || []).some(t => t.status === 'pending' && /^expand_/.test(String(t.task_key || '')));

  if (assessment.round && !hasPendingExpansion) {
    const existing = (run.tasks || []).filter(t => /^expand_/.test(String(t.task_key || ''))).length;
    const query = assessment.queries[existing % assessment.queries.length];
    const provider = existing % 2 === 0 ? 'wuzzuf' : 'forasna';
    await call({
      op: 'task',
      taskKey: 'expand_' + assessment.round + '_' + (existing + 1) + '_' + provider,
      status: 'pending',
      createIfMissing: true,
      taskType: 'search',
      query,
      attempts: 0
    }, { token });
    await call({
      op: 'task',
      taskKey: 'gapsig_' + assessment.markerRound + '_' + assessment.signature,
      status: 'completed',
      createIfMissing: true,
      taskType: 'internal',
      query: assessment.gaps.map(g => g.type).join(','),
      attempts: 0
    }, { token });
    return { status: 200, payload: { run: (await call({ op: 'snapshot' }, { token })).run, continue: true, phase: 'expanding' } };
  }

  if (run.state === 'searching') run = (await call({ op: 'transition', target: 'extracting' }, { token })).run;
  return finalizeRun(run, token);
}

module.exports = {
  executeBatch,
  providerFor,
  rebuildJobs,
  normalizeEvidenceRow,
  assessExpansion,
  expansionBounds,
  gapSignature
};
