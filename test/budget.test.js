'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBudget, searchBudgetMs, DEFAULT_SEARCH_BUDGET_MS, MAX_SEARCH_BUDGET_MS } = require('../src/core/time');

test('a budget expires and reports the remaining time', async () => {
  const budget = createBudget(60);
  assert.equal(budget.total, 60);
  assert.equal(budget.expired(), false);
  assert.ok(budget.remaining() <= 60);
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.equal(budget.expired(), true);
  assert.equal(budget.remaining(), 0);
});

test('a zero budget is already spent, so no page is fetched', () => {
  const budget = createBudget(0);
  assert.equal(budget.expired(), true);
});

test('requested budgets are clamped into the serverless-safe window', () => {
  assert.equal(searchBudgetMs(undefined), DEFAULT_SEARCH_BUDGET_MS);
  assert.equal(searchBudgetMs(null), DEFAULT_SEARCH_BUDGET_MS);
  assert.equal(searchBudgetMs('abc'), DEFAULT_SEARCH_BUDGET_MS);
  assert.equal(searchBudgetMs(0), DEFAULT_SEARCH_BUDGET_MS);
  assert.equal(searchBudgetMs(-100), DEFAULT_SEARCH_BUDGET_MS);
  assert.equal(searchBudgetMs(500), 1000, 'too small a budget is raised to a usable floor');
  assert.equal(searchBudgetMs(9000), 9000);
  assert.equal(searchBudgetMs(10 * 60 * 1000), MAX_SEARCH_BUDGET_MS);
});

test('the retrieval budgets stay well below the deployed function duration limit', () => {
  // vercel.json allows 60s per function; a batch spends at most the search budget
  // on retrieval, leaving room for scoring, the report and ingestion.
  assert.ok(MAX_SEARCH_BUDGET_MS <= 30000);
  assert.ok(DEFAULT_SEARCH_BUDGET_MS < MAX_SEARCH_BUDGET_MS);
});
