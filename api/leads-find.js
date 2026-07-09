// Daily lead finder: Google Places -> self-extract email -> insert new prospects.
// Protected (cron bearer or ?secret=). Niche/city from query or env.
//
//   GET /api/leads-find?secret=...&niche=HVAC%20contractors&city=Kansas%20City

const { findLeads } = require("../agent-lab/packages/connectors/lead-finder");
const { hostname } = require("../agent-lab/packages/connectors/email-extractor");
const { json, sb, authorized, getSettings } = require("../lib/pipeline-db");

module.exports = async function handler(req, res) {
  if (!authorized(req)) return json(res, 401, { ok: false, error: "Unauthorized" });

  let params;
  try {
    params = new URL(req.url, "http://localhost").searchParams;
  } catch {
    params = new URLSearchParams();
  }
  const settings = await getSettings();
  // A scheduled (Vercel cron) call has no ?secret; manual calls do. Pausing only
  // suppresses the scheduled runs — manual runs always work.
  const scheduled = !params.get("secret");
  if (scheduled && settings.crons_paused) {
    return json(res, 200, { ok: true, skipped: "crons_paused" });
  }

  const niche = params.get("niche") || process.env.OUTREACH_NICHE || settings.default_niche;
  const city = params.get("city") || process.env.OUTREACH_CITY || settings.default_city;
  const limit = Number(params.get("limit") || process.env.LEADS_PER_RUN || 25);

  if (!niche || !city) {
    return json(res, 400, {
      ok: false,
      error: "Provide niche and city (query params or OUTREACH_NICHE / OUTREACH_CITY).",
    });
  }

  try {
    // Existing contacts to dedupe against.
    const existing = await sb("prospects?select=email,website");
    const existingEmails = new Set(existing.map((r) => String(r.email || "").toLowerCase()));
    const existingDomains = existing.map((r) => hostname(r.website || "")).filter(Boolean);

    const { leads, skipped, scanned } = await findLeads({
      niche,
      city,
      limit,
      existingDomains,
    });

    // Filter out any whose email already exists, then insert.
    const fresh = leads.filter((l) => !existingEmails.has(l.email.toLowerCase()));
    let inserted = 0;
    if (fresh.length) {
      const rows = await sb("prospects", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(fresh),
      });
      inserted = rows.length;
    }

    return json(res, 200, {
      ok: true,
      niche,
      city,
      scanned,
      found: leads.length,
      inserted,
      skipped,
    });
  } catch (err) {
    return json(res, 500, { ok: false, error: err.message });
  }
};
