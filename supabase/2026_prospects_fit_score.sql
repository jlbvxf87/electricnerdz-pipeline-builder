-- Heuristic lead fit-score (0-100), computed at find-time from Google Places
-- signals (rating + review count) in lead-finder.js. Weighted toward small /
-- owner-operated, active & established, and "room to improve" businesses. The
-- pipeline drafts highest-fit leads first (within the daily cap).

alter table prospects add column if not exists fit_score int;
