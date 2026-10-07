# JobScope Database Schema — 0.5

Operational research tables live in the public schema for Supabase Edge/Data API compatibility, but all operational tables deny anon and authenticated access and are accessed only through the server-side Edge Function.

## Core tables

- research_runs: durable run state, immutable goal snapshot, plan, report, recommendation, token hash and expiry.
- research_events: append-only execution/state events.
- research_tasks: decomposed work items, dependencies, attempts and outcomes.
- sources: canonical source registry and reliability metadata.
- source_documents: bounded retrieved documents with content hash and provenance.
- evidence: claims, status, confidence and provenance.
- evidence_relations: support, contradiction, corroboration and duplicate links.
- job_opportunities: canonical job entities per run, objective decision score and risk flags.
- job_postings: source-specific postings aggregated into canonical opportunities.

## Security invariants

1. RLS is enabled on every operational table.
2. anon and authenticated have no table privileges.
3. Operational rows are not directly exposed through the public Data API.
4. service_role is used only inside the server-side Edge Function.
5. Guest runs use random bearer tokens; only the SHA-256 hash is stored.
6. Tokens expire after seven days and can be revoked.
7. Research state transitions are allowlisted.
8. Retrieval blocks private networks, embedded credentials, unsafe protocols, unvalidated redirects and oversized responses.

## Decision integrity

- A single-source observation is reported.
- Cross-source verification can produce verified_fact.
- Missing values stay unknown.
- Objective opportunity score is distinct from personal-fit score.
