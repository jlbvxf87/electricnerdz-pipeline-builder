// Reads inbound leads from the business's own Supabase `leads` table —
// the Lead Truth agent's default data source. Server-side only (service role).
//
// Idempotency: fetchLeads only returns leads that have never been assessed
// (lead_truth_at is null), and markLeadsAssessed stamps each judged lead with
// the verdict + honest score. Re-running the agent is therefore always safe —
// already-judged leads are never re-drafted.
//
// fetchLeads({ status, limit })        -> [unassessed lead rows]
// markLeadsAssessed(results)           -> stamps lead_truth_at/_verdict/_score

function sbHeaders(serviceRoleKey, extra = {}) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...extra,
  };
}

async function fetchLeads({
  status = "new",
  limit = 20,
  url = process.env.SUPABASE_URL,
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
  fetchImpl,
} = {}) {
  const _fetch = fetchImpl || globalThis.fetch;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.");
  }

  const params = new URLSearchParams({
    select: "*",
    order: "created_at.desc",
    limit: String(limit),
  });
  if (status) params.set("status", `eq.${status}`);
  params.set("lead_truth_at", "is.null"); // never re-judge an assessed lead

  const res = await _fetch(`${url}/rest/v1/leads?${params}`, {
    headers: sbHeaders(serviceRoleKey),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);

  const rows = (await res.json()) || [];
  // The agent uses rows as items directly; just guarantee a stable id.
  return rows.map((r) => ({ ...r, id: r.id || r.contact_email }));
}

// Stamp each judged lead so the next run skips it. `results` is the runner's
// results array: [{ item, action: { verdict, qualityScore } }].
// Best-effort per lead — one failed PATCH never blocks the others.
async function markLeadsAssessed(
  results,
  {
    url = process.env.SUPABASE_URL,
    serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetchImpl,
    now = () => new Date().toISOString(),
  } = {}
) {
  const _fetch = fetchImpl || globalThis.fetch;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.");
  }

  const marked = [];
  for (const r of results || []) {
    const leadId = r && r.item && r.item.id;
    if (!leadId) continue;
    try {
      const res = await _fetch(
        `${url}/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}`,
        {
          method: "PATCH",
          headers: sbHeaders(serviceRoleKey, { "Content-Type": "application/json" }),
          body: JSON.stringify({
            lead_truth_at: now(),
            lead_truth_verdict: (r.action && r.action.verdict) || null,
            lead_truth_score: (r.action && r.action.qualityScore) ?? null,
          }),
        }
      );
      if (res.ok) marked.push(leadId);
    } catch {
      // best-effort: skip and continue
    }
  }
  return marked;
}

module.exports = { fetchLeads, markLeadsAssessed };
