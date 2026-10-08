# Research Control API Contract — 0.9

Endpoint: `POST /functions/v1/research-control` (Supabase Edge Function) or the in-process plane (`RESEARCH_CONTROL_URL=local`).

Every request is JSON with an `op` field. Protected operations require `Authorization: Bearer <accessToken>`; the token is compared by SHA-256 hash and expires after seven days.

## Create

Body: `{ op: "create", goal, mode, preferences?, plan }`

Returns `201 { run, accessToken }`. The access token is a one-time **delivery** (returned once), not a one-time token: it authorizes that single run until it expires or is revoked. The plan may carry `execution: { depth, maxExpansionRounds, maxExpansionTasks }`, which bounds how far the executor may expand.

## Get

Body: `{ op: "get" }` → `{ run }`

## Snapshot

Body: `{ op: "snapshot" }` → `{ run, evidence, sources, opportunities, postings, documents }`

The snapshot is **run-scoped**: `sources` contains only the sources referenced by this run's evidence, postings and documents, and `documents` only the documents retrieved by this run.

## Transition

Body: `{ op: "transition", target }`

`target` is a lifecycle state name (`planning`, `paused`, `cancelled`, `failed`, …) or `resume` for a paused run. Allowed edges come from `src/domain/research/research-run.js` and are mirrored exactly by both planes. Illegal edges return `409 INVALID_STATE_TRANSITION`.

## Task

Body: `{ op: "task", taskKey, status, attempts?, error?, createIfMissing?, taskType?, query? }` → `{ task }`

`status: "running"` increments `attempts`. `createIfMissing` inserts an ad-hoc expansion task.

## Ingest

Body may include `sources`, `documents`, `jobs`, `evidence`, `relations`, `recommendation` and `report`. Payload size is bounded (measured on the raw body, `413 PAYLOAD_TOO_LARGE` otherwise) and per-collection limits apply (20 sources / 50 documents / 150 jobs / 400 evidence).

- `documents` rows are stored with `run_id`, so retrieval stays attributable.
- `jobs` are upserted per `(run_id, canonical_key)`; a posting row is added when `url` is present.
- `evidence` statuses are allowlisted, and `verified_fact` is downgraded to `reported` unless provenance proves `cross_source_core_v1` with at least two independent sources.

## Compare, fork, replay, retry, revoke

- `{ op: "compare", otherToken }` → side-by-side counts and per-opportunity diff.
- `{ op: "fork" | "replay" }` → `201 { run, accessToken }` for a child run (`revision + 1`).
- `{ op: "retry" }` → only allowed when the run is `failed`.
- `{ op: "revoke" }` → clears the token hash and expires the run immediately.

## Errors

`400 UNKNOWN_OPERATION | INVALID_GOAL | PAYLOAD_TOO_LARGE(413)` · `401 UNAUTHORIZED | OTHER_RUN_UNAUTHORIZED` · `409 INVALID_STATE_TRANSITION | RETRY_REQUIRES_FAILED_RUN` · `429 RATE_LIMITED`
