# Contracts

Integration boundaries are contract-first, and the contracts are now **executable**:

- `src/core/contracts/research-run.schema.json` — materialized run as returned by the control plane.
- `src/core/contracts/evidence.schema.json` — stored evidence row (accepts both `sourceId` and `source_id` shapes).
- `src/core/contracts/job-opportunity.schema.json` — canonical job entity (`company` is a string; scores are 0–100 or null).
- `src/core/contracts/report.schema.json` — decision report.

`src/core/contracts/validate.js` implements the JSON-Schema subset these documents use (type, enum, const, required, properties, items, minLength, minimum/maximum, format: date-time) with no dependencies.

`test/contracts.test.js` validates real payloads — a completed run, its stored evidence and opportunities, and the generated report — against these schemas in CI, so a shape change that breaks a boundary fails the build instead of drifting silently.

Rules:

- Contract before integration.
- The frontend never depends on tables or infrastructure details directly.
- Versioned schemas; breaking changes require a versioned migration.
- Facts, estimates and inferences are distinct states and must never be merged.
- Job Opportunity is the canonical entity; Job Posting is one source's representation of it.
- Evidence and provenance are required before a high-confidence recommendation.
