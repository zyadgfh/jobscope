-- Run-scoped retrieval: a guest token must only ever read the documents that
-- belong to its own research run, and redundant postings must not accumulate.
-- Idempotent: safe to re-apply.

alter table if exists public.source_documents add column if not exists run_id uuid references public.research_runs(id) on delete cascade;

create index if not exists source_documents_run_idx on public.source_documents(run_id);

-- Legacy rows have no owner; they are excluded from every run-scoped read.
comment on column public.source_documents.run_id is 'Owning research run; snapshot reads are filtered by this column.';

create index if not exists evidence_run_status_idx on public.evidence(run_id, status);
create index if not exists research_tasks_run_key_idx on public.research_tasks(run_id, task_key);
create index if not exists sources_last_seen_idx on public.sources(last_seen_at desc);

-- Duplicate postings for the same opportunity and URL are prevented at the storage layer.
create unique index if not exists job_postings_opportunity_url_unique_idx on public.job_postings(opportunity_id, canonical_url);
