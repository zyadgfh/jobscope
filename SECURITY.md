# JobScope Security Baseline

## Runtime controls

- No secrets are shipped to browser assets.
- Security headers are configured in `vercel.json`.
- API payloads are bounded by the Node runtime implementation.
- Research claims must carry evidence status and confidence.
- Protected sources are never bypassed.
- Supabase application tables live in a non-exposed `app` schema with RLS enabled and no anonymous grants.
- The legacy public report table has anonymous read/write access revoked.

## Deployment controls

- Production deployment is created from reviewed GitHub source.
- GitHub Actions runs Node tests.
- Production runtime errors are checked after deployment.
- Provider credentials remain environment-side.

## Known limitation

The current production deployment contains the executable Research Run control plane and honest UI, but source retrieval adapters, cross-source extraction, Evidence Graph persistence, scoring, and authentication are still staged behind the foundation. The UI intentionally reports Unknown rather than fabricating results until those layers are active.
