# Architecture Decisions

## ADR-001: Progressive migration

Status: Accepted

Migrate the existing prototype incrementally: Prototype -> Foundation -> Vertical Slice -> MVP -> Production -> Scale.

## ADR-002: Research Intelligence Core

Status: Accepted

Keep JobScope as the first domain pack while separating reusable research capabilities from job-specific logic.

## ADR-003: PostgreSQL source of truth

Status: Accepted

Use PostgreSQL for canonical transactional state. Derived indexes and caches must be rebuildable.

## ADR-004: Provider-agnostic AI and search

Status: Accepted

Provider integrations are adapters. No business-critical domain logic depends on one model or search vendor.

## ADR-005: Evidence before decision

Status: Accepted

Recommendations must be traceable to evidence and confidence; model output alone is not truth.

## ADR-006: Opaque capability tokens, hash-compared

Status: Accepted

Guest runs receive a random opaque token. Only its SHA-256 hash is stored, and authority is proven by hash comparison, never by token format. Token *shape* checks are defensive only; they must accept the format the control plane actually issues. Rejected alternatives: JWTs (an unneeded signing dependency for a capability token) and plaintext token storage.

## ADR-007: Run-scoped retrieval reads

Status: Accepted

`sources` stays a global registry, but every read that a guest can trigger is scoped to their own run: documents carry `run_id`, and `snapshot.sources` is derived from the run's evidence, postings and documents. Rationale: a guest token must never disclose another session's retrieval trail, even when the payload itself is withheld.

## ADR-008: One lifecycle table, two planes

Status: Accepted

Allowed state transitions live once in `src/domain/research/research-run.js` and are mirrored by the Supabase Edge Function and the local control plane. Duplicated allowlists drifted before; a single table plus mirrored tests prevents it.

## ADR-009: One checkpointed batch per serverless invocation

Status: Accepted

A Vercel function is bounded (60 s in `vercel.json`), so the executor never tries to finish a run in one request. `POST /api/research/runs/execute/:id` performs **one** unit of work — a search task, an expansion task, or finalization — persists the run through the control plane, and returns `{ run, continue, phase }`. The browser loops until `continue === false`, and every intermediate state is durable, so a refresh resumes from storage instead of restarting.

Retrieval inside a batch is bounded by a budget (`src/core/time/index.js`: 18 s default, 30 s maximum) that is clamped on the server (`batchBudget`), not trusted from the client. Providers stop fetching once it is spent and report `budgetExhausted`/`skippedLinks`, which surfaces as a `source_failure`/coverage gap rather than a timeout. Rationale: a bounded batch keeps the request inside the function limit, and a visible gap is more honest than a silently truncated result set.
