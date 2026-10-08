'use strict';

const { DEFAULT_SEARCH_BUDGET_MS } = require('../../core/time');

function normalizeGoal(goal) {
  return String(goal || '').trim().replace(/\s+/g, ' ');
}

// Execution bounds are part of the plan so that the executor, the API and the
// tests share a single source of truth for how far expansion may go.
function buildExecution({ depth = 'auto', domain = 'jobs', searchBudgetMs } = {}) {
  const deep = depth === 'deep';
  return {
    depth: deep ? 'deep' : 'auto',
    maxExpansionRounds: deep ? 2 : 1,
    maxExpansionTasks: deep ? 5 : 3,
    // Keeps one checkpointed batch inside the serverless function duration limit.
    searchBudgetMs: searchBudgetMs || DEFAULT_SEARCH_BUDGET_MS,
    batch: 'checkpointed',
    domain
  };
}

function buildQueryPlan({ goal, location = '', domain = 'jobs' }) {
  const g = normalizeGoal(goal);
  const loc = normalizeGoal(location);
  if (!g) throw Object.assign(new Error('goal is required'), { code: 'INVALID_GOAL' });

  if (domain === 'jobs') {
    return {
      version: '1.3',
      domain,
      intent: { goal: g, location: loc },
      tasks: [
        { id: 'search_wuzzuf', type: 'search', provider: 'wuzzuf', query: g + (loc ? ' ' + loc : ''), status: 'pending', dependsOn: [] },
        { id: 'search_forasna', type: 'search', provider: 'forasna', query: g + (loc ? ' ' + loc : ''), status: 'pending', dependsOn: [] },
        { id: 'search_linkedin', type: 'manual_research', provider: 'linkedin', query: g + (loc ? ' ' + loc : ''), status: 'pending', dependsOn: [] },
        { id: 'search_official', type: 'manual_research', provider: 'official_company', query: g + (loc ? ' ' + loc : ''), status: 'pending', dependsOn: [] },
        { id: 'verify_cross_source', type: 'verification', provider: 'core', query: g + (loc ? ' ' + loc : ''), status: 'pending', dependsOn: ['search_wuzzuf', 'search_forasna'] }
      ],
      stopping: { criterion: 'evidence_sufficiency', minIndependentSources: 2 }
    };
  }

  const tasks = [{ id: 'search_web', type: 'search', provider: 'duckduckgo', query: g + (loc ? ' ' + loc : ''), status: 'pending', dependsOn: [] }];
  tasks.push({ id: 'verify_web_sources', type: 'verification', provider: 'core', query: g + (loc ? ' ' + loc : ''), status: 'pending', dependsOn: ['search_web'] });
  return {
    version: '1.3',
    domain,
    intent: { goal: g, location: loc },
    tasks,
    stopping: { criterion: 'source_diversity_and_claim_coverage', minIndependentSources: 3 }
  };
}

module.exports = { buildQueryPlan, buildExecution, normalizeGoal };
