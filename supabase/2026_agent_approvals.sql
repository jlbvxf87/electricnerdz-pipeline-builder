-- Shared agent framework tables: any agent's runs, logs, and pending approvals.
-- Mirrors the agent-core store interface (saveRun/appendLog/createApproval/...).
-- Applied to the live project on 2026-07-12 (migration: agent_approvals_shared_layer).
-- RLS denies all public access; the service role key (server-side) bypasses it.

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  run_id text unique not null,
  agent text not null,
  started_at timestamptz,
  finished_at timestamptz,
  count int default 0,
  results jsonb
);
create index if not exists agent_runs_agent_idx on agent_runs (agent);

create table if not exists agent_logs (
  id bigint generated always as identity primary key,
  at timestamptz default now(),
  run_id text,
  agent text,
  step text,
  item_id text,
  approval_id text,
  entry jsonb
);
create index if not exists agent_logs_run_idx on agent_logs (run_id);

create table if not exists agent_approvals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  run_id text,
  agent text not null,
  item_id text,
  action jsonb not null,
  status text default 'pending',  -- pending | sent | approved_dryrun | blocked | rejected
  approve_token text unique,
  reject_token text unique,
  decided_at timestamptz,
  sent_at timestamptz,
  message_id text
);
create index if not exists agent_approvals_status_idx on agent_approvals (status);
create index if not exists agent_approvals_agent_idx on agent_approvals (agent);
create index if not exists agent_approvals_approve_token_idx on agent_approvals (approve_token);
create index if not exists agent_approvals_reject_token_idx on agent_approvals (reject_token);

alter table agent_runs enable row level security;
alter table agent_logs enable row level security;
alter table agent_approvals enable row level security;
