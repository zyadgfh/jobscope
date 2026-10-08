# JobScope Database Schema — 0.9

Operational research tables live in the `public` schema for Supabase Edge/Data API compatibility, but all operational tables deny anon and authenticated access and are accessed only through the server-side Edge Function.

## Core tables

- research_runs: durable run state, immutable goal snapshot, plan, report, recommendation, token hash and expiry, preferences and their expiry, revision and parent run for forked runs.
- research_events: append-only execution/state events.
- research_tasks: decomposed work items, dependencies, attempts and outcomes.
- sources: canonical source registry and reliability metadata (global registry).
- source_documents: bounded retrieved documents with content hash, provenance and **run_id** ownership.
- evidence: claims, status, confidence and provenance.
- evidence_relations: support, contradiction, corroboration and duplicate links.
- job_opportunities: canonical job entities per run, objective decision score and risk flags.
- job_postings: source-specific postings aggregated into canonical opportunities.

## Migration added in 0.9 (`20261008120000_run_scoped_retrieval.sql`)

- `source_documents.run_id` (FK to `research_runs`, cascade) plus an index — snapshot reads filter on it, so a guest token cannot see another session's documents.
- Indexes for `evidence(run_id, status)`, `research_tasks(run_id, task_key)` and `sources(last_seen_at desc)`.
- Unique index on `job_postings(opportunity_id, canonical_url)` so re-ingesting a run cannot duplicate postings.

## Security invariants

1. RLS is enabled on every operational table.
2. anon and authenticated have no table privileges.
3. Operational rows are not directly exposed through the public Data API.
4. service_role is used only inside the server-side Edge Function.
5. Guest runs use random opaque tokens; only the SHA-256 hash is stored, and tokens expire after seven days.
6. Tokens can be revoked (`op: revoke`) which clears the hash immediately.
7. Research state transitions are allowlisted in one place (`src/domain/research/research-run.js`) and mirrored by both planes.
8. Retrieval blocks private networks (including `0.0.0.0/8` and IPv4-mapped IPv6), embedded credentials, unsafe protocols, IP literals, unvalidated redirects and oversized responses; DNS answers are validated and the connection is pinned to the validated address.
9. Snapshot reads are run-scoped for `documents` and `sources`.

## Decision integrity

- A single-source observation is reported.
- Cross-source verification can produce verified_fact (requires two independent sources).
- Missing values stay unknown.
- Objective opportunity score is distinct from personal-fit score, which only exists when preferences are supplied.
