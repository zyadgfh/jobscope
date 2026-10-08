# JobScope Security Baseline

## Runtime controls

- No secrets are shipped to browser assets.
- Security headers are configured in vercel.json.
- API payloads and stored source documents are bounded.
- Research claims carry explicit evidence status, provenance, and confidence.
- Protected sources are never bypassed.
- Public retrieval validates destination domains, blocks private-network targets and embedded credentials, re-validates redirects, restricts content types, bounds response size, and applies request limits.
- Control-plane requests reject unexpected redirects and validate bearer-token shape before execution.
- Untrusted research content is escaped before DOM insertion.

## Supabase controls

- Application tables are kept in a protected app schema with RLS enabled.
- Anonymous/authenticated direct grants to application tables are revoked.
- Legacy public-report anonymous access has been revoked.
- Guest control-plane RPC execution was revoked rather than exposing privileged database access.
- The active research-control Edge Function is the server-side control plane; service-role credentials are not shipped to the browser.

## Current status

The executable v0.8 pipeline includes checkpointed/resumable execution, source retrieval, job extraction and normalization, evidence integrity, cross-source verification, decision scoring, recommendation/report generation, and durable Supabase persistence.

The UI displays Unknown or empty results when evidence is insufficient; it does not fabricate market facts or scores.

## Deployment dependency

Vercel production deployment must be verified after release. At the current checkpoint the Vercel GitHub App is still not visible to the team integration, so a new production deployment must not be claimed until that connection is restored and the deployment is verified.
