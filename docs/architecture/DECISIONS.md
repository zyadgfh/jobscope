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
