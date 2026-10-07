# Domain Architecture

This directory contains bounded domains for JobScope's Research Intelligence Core.

Initial domains:
- research
- sources
- evidence
- jobs
- scoring

Rules:
- Domains own their business logic and contracts.
- Cross-domain access goes through explicit services/contracts/events.
- UI must not access domain persistence directly.
- Raw source data is never treated as verified truth.
