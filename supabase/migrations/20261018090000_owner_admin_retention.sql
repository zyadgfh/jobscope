-- JobScope v1 owner-only foundation, provider settings and retention.
create extension if not exists pgcrypto;

alter table if exists public.research_runs
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;
create index if not exists research_runs_owner_idx on public.research_runs(owner_id, created_at desc);

create table if not exists public.jobscope_provider_settings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('duckduckgo','brave','tavily')),
  enabled boolean not null default true,
  priority integer not null default 100,
  fallback_mode text not null default 'fallback' check (fallback_mode in ('fallback','stop','manual')),
  secret_ref text,
  updated_at timestamptz not null default now(),
  unique(owner_id, provider)
);

create table if not exists public.jobscope_alert_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  webhook_url text,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.jobscope_alerts (
  id bigserial primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  severity text not null default 'info' check (severity in ('info','warning','error','critical')),
  event_type text not null,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);
create index if not exists jobscope_alerts_owner_idx on public.jobscope_alerts(owner_id, created_at desc);

create table if not exists public.jobscope_usage_daily (
  owner_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  searches integer not null default 0,
  provider_requests integer not null default 0,
  cv_analyses integer not null default 0,
  errors integer not null default 0,
  primary key(owner_id, usage_date)
);

alter table public.research_runs enable row level security;
alter table public.jobscope_provider_settings enable row level security;
alter table public.jobscope_alert_settings enable row level security;
alter table public.jobscope_alerts enable row level security;
alter table public.jobscope_usage_daily enable row level security;

drop policy if exists owner_research_runs on public.research_runs;
create policy owner_research_runs on public.research_runs for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists owner_provider_settings on public.jobscope_provider_settings;
create policy owner_provider_settings on public.jobscope_provider_settings for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists owner_alert_settings on public.jobscope_alert_settings;
create policy owner_alert_settings on public.jobscope_alert_settings for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists owner_alerts on public.jobscope_alerts;
create policy owner_alerts on public.jobscope_alerts for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists owner_usage on public.jobscope_usage_daily;
create policy owner_usage on public.jobscope_usage_daily for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Retention is intentionally explicit and idempotent; schedule this function daily.
create or replace function public.jobscope_cleanup_expired() returns integer
language plpgsql security definer set search_path = public as $$
declare deleted_count integer;
begin
  delete from public.research_events where created_at < now() - interval '30 days';
  get diagnostics deleted_count = row_count;
  delete from public.research_tasks where created_at < now() - interval '30 days' and exists (
    select 1 from public.research_runs r where r.id = research_tasks.run_id and r.state in ('completed','cancelled','failed')
  );
  delete from public.source_documents where retrieved_at < now() - interval '30 days';
  return deleted_count;
end;
$$;
revoke all on function public.jobscope_cleanup_expired() from public, anon, authenticated;
grant execute on function public.jobscope_cleanup_expired() to service_role;
