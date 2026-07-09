// Who the agent is allowed to contact today — enforced in code, not by trust.
// Stop signs: never email opt-outs, never follow up after a reply/no, respect
// the max-follow-ups cap and the daily volume cap.

const STOP_REPLY_STATES = new Set([
  "replied",
  "no",
  "not_interested",
  "unsubscribed",
  "bounced",
]);

function truthy(v) {
  if (typeof v === "boolean") return v;
  const s = String(v || "").trim().toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "1";
}

function addDays(ms, days) {
  return ms + days * 24 * 60 * 60 * 1000;
}

// Returns { eligible: [{ row, kind }], skipped: [{ row, reason }] }.
// kind is "first" (initial touch) or "follow_up".
function selectProspects(rows, config, nowMs) {
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  const eligible = [];
  const skipped = [];

  for (const row of rows || []) {
    if (truthy(row.opt_out)) {
      skipped.push({ row, reason: "opted_out" });
      continue;
    }

    const reply = String(row.reply_status || "").trim().toLowerCase();
    if (STOP_REPLY_STATES.has(reply)) {
      skipped.push({ row, reason: `reply_status:${reply}` });
      continue;
    }

    const sentCount = Number(row.sent_count || 0);
    const status = String(row.email_status || "").trim().toLowerCase();

    // First touch: explicitly marked Ready and nothing sent yet.
    if (status === "ready" && sentCount === 0) {
      eligible.push({ row, kind: "first" });
      continue;
    }

    // Follow-up: something was sent, there's a due follow-up date, and we
    // haven't exhausted the follow-up cap (initial + maxFollowUps).
    if (sentCount > 0 && sentCount < 1 + config.maxFollowUps) {
      const due = row.follow_up_date ? Date.parse(row.follow_up_date) : NaN;
      if (!Number.isNaN(due) && due <= now) {
        eligible.push({ row, kind: "follow_up" });
        continue;
      }
      skipped.push({ row, reason: "not_due" });
      continue;
    }

    skipped.push({ row, reason: "no_action" });
  }

  // Prioritize by lead fit score so the daily cap goes to the best leads first.
  eligible.sort((a, b) => (Number(b.row.fit_score) || 0) - (Number(a.row.fit_score) || 0));

  // Daily volume cap.
  const capped = eligible.slice(0, config.dailyCap);
  const overflow = eligible.slice(config.dailyCap).map((e) => ({
    row: e.row,
    reason: "daily_cap",
  }));

  return { eligible: capped, skipped: skipped.concat(overflow) };
}

module.exports = { selectProspects, addDays, truthy, STOP_REPLY_STATES };
