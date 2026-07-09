// Orchestrates the daily lead pull:
//   Google Places (find businesses) -> self-extract email from their site
//   -> dedupe -> shape prospect rows for the Supabase `prospects` table.
//
// Pulls up to `limit` NEW leads (default 25). Businesses with no website or no
// findable published email are skipped — that's expected, you just top up.

const { searchBusinesses } = require("./google-places");
const { extractEmailFromSite, hostname } = require("./email-extractor");

// Heuristic lead fit-score (0-100) from Google Places signals, weighted toward
// what converts for us: small / owner-operated (reachable decision-maker),
// active & established (real business with budget), and "room to improve"
// (mid ratings = operational gaps = an opening for the pitch).
function computeFitScore(b) {
  const n = Number(b.userRatingCount || 0);
  const r = Number(b.rating || 0);
  let score = 50;

  // Small but active: reachable owner, established, not big enough to have an agency.
  if (n >= 10 && n <= 150) score += 22;
  else if ((n >= 5 && n < 10) || (n > 150 && n <= 300)) score += 12;
  else if (n >= 1 && n < 5) score += 2;
  else if (n > 300) score -= 8; // likely has a team / agency already
  else score -= 4; // no reviews — uncertain

  // Room to improve: mid ratings signal missed follow-up / operational gaps.
  if (r >= 3.3 && r <= 4.4) score += 22;
  else if (r >= 3.0 && r < 3.3) score += 8;
  else if (r >= 4.5 && r <= 4.7) score += 8;
  else if (r > 0 && r < 3.0) score -= 10; // struggling / risky
  // r >= 4.8 or no rating → +0 (little obvious pain / unknown)

  if (b.phone) score += 4; // reachable

  return Math.max(10, Math.min(96, Math.round(score)));
}

async function findLeads({ niche, city, limit, existingDomains = [], apiKey, fetchImpl } = {}) {
  const target = Number(limit || process.env.LEADS_PER_RUN || 25);
  const seen = new Set(existingDomains.map((d) => String(d).toLowerCase()));

  // Pull extra candidates because some get dropped (no site / no email / dupe).
  const candidates = await searchBusinesses({
    niche,
    city,
    limit: target * 3,
    apiKey,
    fetchImpl,
  });

  const leads = [];
  const skipped = { no_website: 0, no_email: 0, duplicate: 0 };

  for (const b of candidates) {
    if (leads.length >= target) break;
    if (!b.website) {
      skipped.no_website++;
      continue;
    }
    const domain = hostname(b.website);
    if (!domain || seen.has(domain)) {
      skipped.duplicate++;
      continue;
    }
    const email = await extractEmailFromSite(b.website, { fetchImpl });
    if (!email) {
      skipped.no_email++;
      continue;
    }
    seen.add(domain);
    leads.push({
      company: b.company,
      website: b.website,
      phone: b.phone || "",
      fit_score: computeFitScore(b),
      contact_name: "",
      email,
      source: `google_places:${niche} / ${city}`,
      business_type: niche,
      pain_signal: "",
      notes: b.address || "",
      email_status: "Ready",
      sent_count: 0,
      follow_up_date: null,
      reply_status: "",
      opt_out: false,
    });
  }

  return { leads, skipped, scanned: candidates.length };
}

module.exports = { findLeads };
