-- Lead Truth writes its verdict back to the lead so runs are idempotent:
-- the connector only reads unassessed leads (lead_truth_at is null), and the
-- honest score lives permanently next to the platform's quiz score.
-- Applied to the live project on 2026-07-12 (migration: leads_lead_truth_assessment).
alter table leads add column if not exists lead_truth_at timestamptz;
alter table leads add column if not exists lead_truth_verdict text;
alter table leads add column if not exists lead_truth_score int;
create index if not exists leads_lead_truth_idx on leads (lead_truth_at) where lead_truth_at is null;
