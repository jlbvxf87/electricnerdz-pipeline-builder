-- Pipeline Builder settings: a single-row control table the Telegram bot writes.
--   crons_paused  — when true, the scheduled (Vercel cron) leads-find / pipeline-run
--                   runs skip; manual (?secret=) runs always work.
--   default_city / default_niche — targeting the daily leads-find falls back to
--                   when OUTREACH_CITY / OUTREACH_NICHE env vars aren't set.
-- RLS on; the service-role key (server-side) bypasses it.

create table if not exists pipeline_settings (
  id int primary key default 1,
  crons_paused boolean not null default false,
  default_city text,
  default_niche text,
  updated_at timestamptz default now(),
  constraint pipeline_settings_singleton check (id = 1)
);

insert into pipeline_settings (id) values (1) on conflict (id) do nothing;

alter table pipeline_settings enable row level security;
