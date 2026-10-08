'use strict';

// Serverless functions are killed at their configured duration limit, so every
// retrieval batch runs against an explicit wall-clock budget instead of an
// unbounded number of pages.
const DEFAULT_SEARCH_BUDGET_MS = 18000;
const MAX_SEARCH_BUDGET_MS = 30000;

function createBudget(ms) {
  const total = Math.max(0, Number(ms) || 0);
  const deadline = Date.now() + total;
  return {
    total,
    remaining: () => Math.max(0, deadline - Date.now()),
    expired: () => Date.now() >= deadline
  };
}

function searchBudgetMs(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_SEARCH_BUDGET_MS;
  return Math.min(MAX_SEARCH_BUDGET_MS, Math.max(1000, requested));
}

module.exports = { createBudget, searchBudgetMs, DEFAULT_SEARCH_BUDGET_MS, MAX_SEARCH_BUDGET_MS };
