# Changelog

## 0.9.0 — repair release

Full audit (`jobscope-review.md`) followed by fixes across the executable path, security and hygiene.

### Blockers fixed

1. `api/research/runs/execute/[id].js` demanded a JWT-shaped token while the control plane issues an opaque 32-byte token → every execution returned `401 INVALID_ACCESS_TOKEN`. The handler now validates token shape only and defers authority to the control-plane hash check.
2. `api/research/runs/[id].js` forwarded the raw `Authorization` header and then added `Bearer` again → `GET` and the action endpoints returned `401`. Tokens are now normalised (`normalizeToken`) before being sent.
3. `src/domain/research/report.js` read `o.postings.map(...)` from items that never carried `postings` → `TypeError` during finalization, turning every finished run into `failed` with a 500. The report builder now tolerates both domain and storage shapes and never throws.
4. Expansion round math computed `nextRound = max + 0` once a round existed → unbounded `expand_*` task creation. Counting is fixed (`max + 1`), bounded by the plan (`maxExpansionRounds`, `maxExpansionTasks`) with a hard ceiling, and a `gaps_unchanged` marker stops pointless rounds. Terminal runs record `stopping.reason`.
5. `pause`/`cancel` sent state-machine targets `pause`/`cancel` instead of `paused`/`cancelled` → `409` every time. Actions are now mapped to state names.
6. `app.js` called undefined `renderRun()` and `stateLabel()` → the UI threw immediately after creating a run. Both are implemented, and the workspace/report renders from real run state.
7. DuckDuckGo was not in the source registry, so discovery fetches were rejected as `SOURCE_NOT_REGISTERED`. The search engine is now a registered source, and the unregistered fallback is only used for links discovered through it.
8. `job-board-search.js` dropped protocol-relative hrefs (`//duckduckgo.com/l/?uddg=…`), the shape DuckDuckGo actually returns → zero results. Redirect decoding is shared (`src/application/duckduckgo-search.js`) and handles both forms.

### Security

- **SSRF:** the fetcher now blocks `0.0.0.0/8` (hostname `0`/`0.0.0.0` reached loopback in Linux), IPv4-mapped/compatible IPv6, NAT64/6to4/ULA/link-local/multicast/documentation ranges, IP literals, and `.local`/`.internal`/`.home.arpa` suffixes. DNS answers are all checked and the connection is pinned to the validated address (no rebinding window); redirects are refused; declared and streamed sizes are capped; only `text/html`/`text/plain` are accepted.
- **Cross-run disclosure:** `snapshot` returned the 100 most recent sources and documents for any valid token. Documents now carry `run_id` and `snapshot` is run-scoped in both planes (migration `20261008120000_run_scoped_retrieval.sql`).
- `POST /api/research/sources/fetch` requires a run token and enforces 10 requests/minute/IP instead of acting as an anonymous relay.
- The local server serves an explicit static allowlist instead of the whole repository, and applies the same security headers as `vercel.json`.
- Edge Function: payload size is now checked against the raw body (not only `content-length`), and rate-limit maps self-clear instead of growing without bound.

### Data integrity

- The canonical lifecycle table lives in `src/domain/research/research-run.js` and is shared by the Edge Function and the local plane (ADR-008).
- Source diversity is measured across all posting sources of an opportunity instead of only the first one, so a genuinely cross-listed job no longer triggers needless expansion.
- Finalization re-ingests the posting URL, so cross-source verification and posting counts survive into later snapshots.
- Preferences from the UI actually reach the pipeline: `#minSalary`, `#workModePref`, `#targetAreas`, `#requiredKeywords` exist in the markup, and personal fit is computed when they are supplied.

### Contracts and tests

- JSON Schema contracts (run, evidence, job-opportunity, report) are now validated against real payloads by `test/contracts.test.js` using a dependency-free subset validator.
- Test suite grew from 33 string-matching tests to 85 tests, including a full create → execute → completed run, run isolation between tokens, the SSRF matrix, transport limits, and the evidence-status gate.
- CI runs on every branch (`npm test`, `npm run check`, module-graph import).

### Hygiene

- Versions unified at 0.9.0 (report `1.3`); docs (README, SECURITY, SCHEMA, CONTROL API, FOUNDATION, CONTRACTS, plan) rewritten to match behaviour.
- Removed dead code: `research-store.js`, `research-service.js`, `vercel-research.js`, `research-orchestrator.js`, `app.config.ts`, `manus-routes.json`.
- `.env.example` documents `RESEARCH_CONTROL_URL` and `JOBSCOPE_LOCAL_STORE` (unused Firebase variables removed); Dockerfile runs as non-root with a healthcheck and `.dockerignore` excludes `.env`.
