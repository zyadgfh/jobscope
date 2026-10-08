'use strict';

// Report builder. Every field is optional-tolerant on purpose: the executor can
// legitimately hand over arrays that are still in "posting" shape rather than
// grouped-opportunity shape, and a report must never be the reason a run fails.
function sourceCountOf(opportunity) {
  if (Number.isFinite(Number(opportunity?.sourceCount))) return Number(opportunity.sourceCount);
  const postings = Array.isArray(opportunity?.postings) ? opportunity.postings : [];
  return new Set(postings.map(p => p?.sourceId ?? p?.source_id).filter(Boolean)).size;
}

function opportunityView(item) {
  const representative = item?.representative || item || {};
  return {
    key: item?.key ?? item?.canonical_key ?? null,
    id: item?.representative?.id ?? item?.id ?? null,
    title: representative?.title ?? null,
    company: representative?.company ?? null,
    location: representative?.location ?? null,
    decisionScore: item?.decisionScore ?? item?.decision_score ?? null,
    objectiveScore: item?.objectiveScore ?? item?.objective_score ?? null,
    fitScore: item?.fitScore ?? item?.fit?.score ?? null,
    dataQuality: item?.dataQuality ?? item?.data_quality ?? null,
    riskFlags: Array.isArray(item?.riskFlags) ? item.riskFlags : [],
    sourceCount: sourceCountOf(item)
  };
}

// Accepts both the domain shape (sourceId) and the storage shape (source_id).
function sourceIdOf(evidence) {
  return evidence?.sourceId ?? evidence?.source_id ?? null;
}

function buildReport({ run, evidence = [], recommendation = null, opportunities = [], evidenceScore = null, gaps = [], stopping = null } = {}) {
  const items = Array.isArray(opportunities) ? opportunities.filter(Boolean) : [];
  const claims = Array.isArray(evidence) ? evidence : [];
  return {
    version: '1.3',
    runId: run?.id || null,
    generatedAt: new Date().toISOString(),
    executive: {
      recommendation: recommendation || { status: 'insufficient_evidence' },
      evidenceCount: claims.length,
      sourceCount: new Set(claims.map(sourceIdOf).filter(Boolean)).size
    },
    evidenceScore,
    stopping,
    gaps,
    opportunities: items.map(opportunityView),
    claims: claims.map(e => ({
      claim: e?.claim,
      status: e?.status,
      confidence: e?.confidence,
      sourceId: sourceIdOf(e),
      retrievedAt: e?.retrievedAt ?? e?.retrieved_at ?? null,
      provenance: e?.provenance
    }))
  };
}

module.exports = { buildReport };
