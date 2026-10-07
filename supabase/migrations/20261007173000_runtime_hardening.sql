-- JobScope runtime additions after secure_research_core.
-- Idempotent against both the historical app schema and the current public schema.

do $$ declare p text; begin
  foreach p in array array['research_runs','research_events','sources','evidence','research_tasks','source_documents','job_opportunities','job_postings','evidence_relations'] loop
    execute format('alter table if exists app.%I set schema public',p);
  end loop;
end $$;

drop schema if exists app;

alter table if exists public.research_runs add column if not exists access_token_hash text unique;
alter table if exists public.research_runs add column if not exists token_expires_at timestamptz;
alter table if exists public.research_runs add column if not exists paused_from text;
alter table if exists public.research_runs add column if not exists parent_run_id uuid references public.research_runs(id) on delete set null;
alter table if exists public.research_runs add column if not exists revision integer not null default 1 check(revision>0);

alter table if exists public.job_opportunities add column if not exists decision_score numeric(5,2) check(decision_score between 0 and 100);
alter table if exists public.job_opportunities add column if not exists data_quality numeric(5,2) check(data_quality between 0 and 100);
alter table if exists public.job_opportunities add column if not exists risk_flags jsonb not null default '[]'::jsonb;

create table if not exists public.research_tasks (
 id bigserial primary key, run_id uuid not null references public.research_runs(id) on delete cascade,
 task_key text not null, task_type text not null, query text, status text not null default 'pending',
 depends_on jsonb not null default '[]'::jsonb, attempts integer not null default 0, last_error text,
 started_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now(),
 unique(run_id,task_key)
);
create table if not exists public.source_documents (
 id uuid primary key default gen_random_uuid(), source_id uuid references public.sources(id) on delete set null,
 canonical_url text not null, title text, content_type text, content_hash text, content text,
 retrieval_method text not null, retrieved_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb,
 unique(canonical_url,content_hash)
);
create table if not exists public.job_opportunities (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.research_runs(id) on delete cascade,
 canonical_key text not null, title text, company text, location text, salary jsonb,
 requirements jsonb not null default '[]'::jsonb, benefits jsonb not null default '[]'::jsonb,
 employment jsonb not null default '{}'::jsonb, fit jsonb, risk jsonb, decision_score numeric(5,2),
 data_quality numeric(5,2), risk_flags jsonb not null default '[]'::jsonb, created_at timestamptz not null default now(),
 unique(run_id,canonical_key)
);
create table if not exists public.job_postings (
 id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.job_opportunities(id) on delete cascade,
 source_id uuid references public.sources(id) on delete set null, canonical_url text not null,
 raw_data jsonb not null default '{}'::jsonb, retrieved_at timestamptz not null default now(),
 unique(opportunity_id,canonical_url)
);
create table if not exists public.evidence_relations (
 evidence_id uuid not null references public.evidence(id) on delete cascade,
 related_evidence_id uuid not null references public.evidence(id) on delete cascade,
 relation text not null check(relation in ('supports','contradicts','corroborates','duplicates')),
 primary key(evidence_id,related_evidence_id,relation)
);

create index if not exists research_runs_parent_idx on public.research_runs(parent_run_id);
create index if not exists research_runs_state_idx on public.research_runs(state);
create index if not exists research_tasks_run_status_idx on public.research_tasks(run_id,status);
create index if not exists source_documents_source_idx on public.source_documents(source_id);
create index if not exists source_documents_url_idx on public.source_documents(canonical_url);
create index if not exists job_opportunities_run_idx on public.job_opportunities(run_id);
create index if not exists job_opportunities_run_decision_idx on public.job_opportunities(run_id,decision_score desc);
create index if not exists job_postings_opportunity_idx on public.job_postings(opportunity_id);
create index if not exists job_postings_source_idx on public.job_postings(source_id);
create index if not exists evidence_relations_related_idx on public.evidence_relations(related_evidence_id);
create unique index if not exists sources_canonical_url_unique_idx on public.sources(canonical_url) where canonical_url is not null;

revoke all on schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
grant select,insert,update,delete on all tables in schema public to service_role;
grant usage,select,update on all sequences in schema public to service_role;

alter table public.research_runs enable row level security;
alter table public.research_events enable row level security;
alter table public.sources enable row level security;
alter table public.evidence enable row level security;
alter table public.research_tasks enable row level security;
alter table public.source_documents enable row level security;
alter table public.job_opportunities enable row level security;
alter table public.job_postings enable row level security;
alter table public.evidence_relations enable row level security;

drop policy if exists deny_anon_research_runs on public.research_runs;
drop policy if exists deny_anon_research_events on public.research_events;
drop policy if exists deny_anon_sources on public.sources;
drop policy if exists deny_anon_evidence on public.evidence;
drop policy if exists deny_anon_research_tasks on public.research_tasks;
drop policy if exists deny_anon_source_documents on public.source_documents;
drop policy if exists deny_anon_job_opportunities on public.job_opportunities;
drop policy if exists deny_anon_job_postings on public.job_postings;
drop policy if exists deny_anon_evidence_relations on public.evidence_relations;

create policy deny_anon_research_runs on public.research_runs for all to anon,authenticated using(false) with check(false);
create policy deny_anon_research_events on public.research_events for all to anon,authenticated using(false) with check(false);
create policy deny_anon_sources on public.sources for all to anon,authenticated using(false) with check(false);
create policy deny_anon_evidence on public.evidence for all to anon,authenticated using(false) with check(false);
create policy deny_anon_research_tasks on public.research_tasks for all to anon,authenticated using(false) with check(false);
create policy deny_anon_source_documents on public.source_documents for all to anon,authenticated using(false) with check(false);
create policy deny_anon_job_opportunities on public.job_opportunities for all to anon,authenticated using(false) with check(false);
create policy deny_anon_job_postings on public.job_postings for all to anon,authenticated using(false) with check(false);
create policy deny_anon_evidence_relations on public.evidence_relations for all to anon,authenticated using(false) with check(false);

revoke all on function public.create_guest_research_run(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.get_guest_research_run(uuid) from public,anon,authenticated;
