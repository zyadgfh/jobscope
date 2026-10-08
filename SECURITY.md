# JobScope Security Baseline

## Runtime controls

- No secrets are shipped to browser assets.
- Security headers are applied to every response, both in `vercel.json` and by `src/api/security-headers.js` for the Node server.
- API payloads are bounded while reading (`512 KB` transport cap) and control-plane ingest is capped (`2.5 MB`).
- Access tokens are opaque 32-byte values compared only as SHA-256 hashes, expire after seven days, and can be revoked. The API validates token *shape* (`^[A-Za-z0-9_\-.]{16,300}$`) and the control plane proves authority by hash — a token is never trusted because it "looks like a JWT".
- Research claims carry explicit evidence status, provenance, and confidence.
- Protected sources are never bypassed; blocked manual work is surfaced as a manual-open link.
- Untrusted research content is escaped before DOM insertion (single `esc()` boundary).

## Retrieval hardening

`src/application/source-fetcher.js` is the only path that reaches the public web. It enforces, in order:

1. Only `http:`/`https:`; credentials inside the URL are rejected.
2. Hostname denial for `localhost`, `.localhost`, `.local`, `.internal`, `.home.arpa`, IP literals, and any address in a blocked range.
3. Blocked IPv4 ranges: `0.0.0.0/8` (wildcard/loopback), `10/8`, `100.64/10`, `127/8`, `169.254/16` (metadata), `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.88.99/24`, `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`, `224/4`, `240/4`.
4. Blocked IPv6: `::`, `::1`, IPv4-mapped/compatible (inherits the embedded IPv4 verdict), NAT64, 6to4, `fc00::/7`, `fe80::/10`, `ff00::/8`, `2001:db8::/32`.
5. DNS is resolved once and **every** returned address is checked; the connection is then pinned to the validated address (custom `lookup`), closing the rebinding/TOCTOU window.
6. Redirects are refused (`REDIRECT_BLOCKED`) instead of re-validated.
7. Response bodies are streamed with a hard byte cap and a request timeout; the declared `content-length` is checked before reading.
8. Only `text/html` and `text/plain` are accepted.
9. Unregistered domains are refused unless the caller explicitly opts in — that opt-in is used only for links discovered through the registered DuckDuckGo endpoint.

`POST /api/research/sources/fetch` additionally requires a run token and is rate limited (10 requests/minute/IP), so retrieval is a capability rather than an open relay.

## Control-plane controls

- `snapshot` is run-scoped: sources are restricted to the ones referenced by this run's evidence, postings, and documents, and documents are filtered by `run_id` (migration `20261008120000_run_scoped_retrieval.sql`). One guest token can never read another session's retrieval trail.
- `verified_fact` is only granted when provenance carries `verificationMethod: cross_source_core_v1` with at least two independent sources; every other request is downgraded to `reported` (identical logic in the Edge Function and the local control plane).
- State transitions follow one allowlisted table (`src/domain/research/research-run.js`), mirrored by both planes.
- Rate-limit maps self-clear at 10 000 entries instead of growing without bound.
- Requests reject unexpected redirects (`redirect: 'error'`) and validate bearer-token shape before execution.

## Supabase controls

- Application tables live in the `public` schema for Edge/Data API compatibility with RLS enabled.
- Anonymous/authenticated direct grants to application tables are revoked and `deny_anon_*` policies are enforced.
- Guest control-plane RPC execution was revoked rather than exposing privileged database access.
- The research-control Edge Function is the server-side control plane; service-role credentials never reach the browser.

## Current status

The executable v0.9 pipeline includes checkpointed/resumable execution with bounded expansion, source retrieval, job extraction and normalization, evidence integrity, cross-source verification, decision scoring, recommendation/report generation, and durable persistence (Supabase or the in-process local plane).

The UI displays Unknown or empty results when evidence is insufficient; it does not fabricate market facts or scores.

## Verification

`npm test` covers the SSRF matrix (including `0.0.0.0`, IPv4-mapped IPv6, rebinding, decimal/octal notation), transport limits (redirects, oversized and slow responses), run isolation between tokens, the evidence-status gate, the state machine, the report shape, and a full create → execute → completed run. `npm run check` type-checks nothing but catches syntax regressions across `api/`, `src/` and `test/`.

## Deployment dependency

Vercel production deployment must be verified after release, and the production environment must define `RESEARCH_CONTROL_URL`. A new production deployment must not be claimed until the deployment is verified.
