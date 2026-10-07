# JobScope Foundation v0.2

## Direction

JobScope is the first domain product on top of a provider-agnostic Research Intelligence Core.

## First vertical slice

User Goal -> Research Run -> Plan -> Search -> Source Adapter -> Extraction -> Normalization -> Entity Resolution -> Evidence -> Verification -> Confidence -> Scoring -> Recommendation -> Report

## Persistence

PostgreSQL is the source of truth. Redis, object storage, queues, vector/full-text search and analytics are derived infrastructure selected by workload.

## Research runs

Every research execution is durable and addressable by a Run ID. Runs support checkpoints, retry, pause/resume, cancellation, replay and comparison.

## Evidence

Claims are linked to evidence, source, retrieval metadata and verification state. Fact, reported, estimated, inferred, conflicting and unknown states remain distinct.

## AI

Models are providers behind an abstraction. Local, free, BYOK and paid providers may be routed without coupling domain logic to a vendor.

## Security

Web content is data, never authority. Agents receive capabilities rather than raw secrets. Tool execution is policy-checked and audited.

## Prototype migration

The existing UI remains the UX reference. Mock research outputs are replaced incrementally by real services; the prototype is not rewritten blindly.
