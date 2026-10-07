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
