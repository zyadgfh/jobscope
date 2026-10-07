# Research Control API Contract — 0.5

Endpoint: POST /functions/v1/research-control

## Create

Body: { op: create, goal, mode, plan }

Returns a durable run and a one-time bearer token.

## Read

Header: Authorization: Bearer <accessToken>

Body: { op: get }

## Transition

Body: { op: transition, target }

Allowed targets are the governed research lifecycle states plus pause, resume, cancel and failure transitions.

## Task update

Body: { op: task, taskKey, status, attempts?, error? }

## Ingest

Body may include sources, documents, jobs, evidence, relations, recommendation and report. The function bounds payload size and uses the service-role boundary for persistence.
