'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('frontend defines an HTML escaping boundary', () => {
  assert.match(app, /const esc=v=>/);
  assert.match(app, /esc\(claim\.claim\)/);
  assert.match(app, /esc\(job\.title/);
  assert.doesNotMatch(app, /h4>'\+x\.claim/);
});

test('every dynamic value rendered into the report is escaped', () => {
  assert.match(app, /esc\(job\.title/);
  assert.match(app, /esc\(job\.company/);
  assert.match(app, /esc\(claim\.claim\)/);
  assert.match(app, /esc\(step\)/);
  assert.match(app, /esc\(item\)/);
  assert.match(app, /esc\(link\.href\)/);
});

test('access tokens are never attached to the window object', () => {
  assert.doesNotMatch(app, /window\.currentResearchAccessToken/);
  assert.match(app, /localStorage\.setItem\(RUN_STORAGE_KEY/);
});

test('the preference inputs the script reads exist in the markup', () => {
  for (const id of ['minSalary', 'workModePref', 'targetAreas', 'requiredKeywords']) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} must exist for preferences to be sent`);
  }
});

test('every element the script queries exists in the markup', () => {
  const ids = [...app.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map(match => match[1]);
  const unique = [...new Set(ids)];
  for (const id of unique) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} is queried by app.js but missing from index.html`);
  }
});

test('the report renders a list of opportunities as a count, not as text', () => {
  assert.match(app, /reportOpportunities/);
  assert.doesNotMatch(app, /\$\('#opportunities'\)\.textContent=report\.opportunities\?\?/);
});

test('decision scores are read from the stored snake_case field', () => {
  assert.match(app, /job\.decision_score\?\?job\.decisionScore/);
});

test('the page does not rely on inline styles or inline scripts', () => {
  assert.doesNotMatch(html, /<script(?![^>]*src=)/i, 'no inline script blocks');
  assert.doesNotMatch(html, /\sstyle="/i, 'no inline style attributes (CSP style-src self)');
});
