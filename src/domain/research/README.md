# Research Domain

The Research domain owns durable research-run lifecycle and orchestration contracts.

Initial lifecycle:

created -> planning -> searching -> extracting -> verifying -> scoring -> reporting -> completed

Terminal/interrupt states:
- paused
- cancelled
- failed

Required invariants:
- Every run has an immutable goal snapshot.
- Every state transition is observable.
- Retries are idempotent.
- Checkpoints enable resume/replay.
- A recommendation must remain traceable to its run and evidence snapshot.
