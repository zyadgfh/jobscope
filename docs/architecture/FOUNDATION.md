# JobScope Foundation v0.9

## Direction

JobScope is the first domain product on top of a provider-agnostic Research Intelligence Core.

## First vertical slice

User Goal -> Research Run -> Plan -> Search -> Source Adapter -> Extraction -> Normalization -> Entity Resolution -> Evidence -> Verification -> Confidence -> Scoring -> Recommendation -> Report

The slice is executable end to end today: `POST /api/research/runs` creates a durable run, `POST /api/research/runs/execute/:id` advances it one checkpointed batch at a time, and the run reaches `completed` with a report that records why expansion stopped.

## Persistence

PostgreSQL is the source of truth in production (Supabase control plane). For local development the same contract is served by an in-process control plane (`src/infrastructure/local-research-control.js`) backed by a JSON file, so no cloud credentials are needed to exercise the production code path.

## Research runs

Every research execution is durable and addressable by a Run ID. Runs support checkpoints, pause/resume, cancellation, replay, fork and comparison. Expansion is bounded by the plan (`execution.maxExpansionRounds`, `execution.maxExpansionTasks`) with a hard executor ceiling, and every terminal run records a `stopping.reason` (`no_gaps`, `gaps_unchanged`, `expansion_rounds_exhausted`, `expansion_task_budget_exhausted`).

## Evidence

Claims are linked to evidence, source, retrieval metadata and verification state. Fact, reported, estimated, inferred, conflicting and unknown states remain distinct. `verified_fact` requires cross-source verification with at least two independent sources, enforced identically in the Edge Function and the local plane.

## AI

Models are providers behind an abstraction. Local, free, BYOK and paid providers may be routed without coupling domain logic to a vendor.

## Security

Web content is data, never authority. Agents receive capabilities (run-scoped tokens) rather than raw secrets. Tool execution is policy-checked and audited, retrieval is bounded and SSRF-hardened, and snapshot reads are run-scoped.

## Prototype migration

The prototype UI remains the UX reference and now runs against the real pipeline. Mock outputs are gone: the interface shows Unknown or empty states when evidence is insufficient.
