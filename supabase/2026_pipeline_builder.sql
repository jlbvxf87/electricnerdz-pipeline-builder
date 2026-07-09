-- Pipeline Builder tables: prospects (the list) + outreach_approvals (drafts/log).
-- Run this in the Supabase SQL editor. RLS denies public access; the service
-- role key (used server-side) bypasses RLS.

-- Prospects the agent reads.
create table if not exists prospects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  company text,
  website text,
  contact_name text,
  email text not null,
  source text,
  business_type text,
  pain_signal text,
  notes text,
  email_status text default 'Ready',   -- Ready | Sent
  sent_count int default 0,
  follow_up_date date,
  reply_status text default '',         -- '' | replied | no | unsubscribed | bounced
  opt_out boolean default false
);
create unique index if not exists prospects_email_key on prospects (lower(email));
create index if not exists prospects_status_idx on prospects (email_status);

-- Drafted outreach awaiting approval — also the durable outreach log.
create table if not exists outreach_approvals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  prospect_email text,
  touch text,                 -- first | follow_up
  subject text,
  body text,
  from_email text,
  offer_angle text,
  cleared boolean default false,
  compliance jsonb,
  follow_up_date date,
  status text default 'pending',  -- pending | sent | blocked | rejected
  approve_token text unique,
  sent_at timestamptz,
  message_id text,
  action jsonb
);
create index if not exists outreach_approvals_token_idx on outreach_approvals (approve_token);
create index if not exists outreach_approvals_status_idx on outreach_approvals (status);

-- Lock down: deny all public/anon access; service role bypasses RLS.
alter table prospects enable row level security;
alter table outreach_approvals enable row level security;
