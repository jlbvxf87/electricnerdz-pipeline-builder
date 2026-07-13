// Reads inbound leads from the business's own Supabase `leads` table —
// the Lead Truth agent's default data source. Server-side only (service role).
//
// fetchLeads({ status, limit }) -> [lead rows shaped for the agent]

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

  const res = await _fetch(`${url}/rest/v1/leads?${params}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);

  const rows = (await res.json()) || [];
  // The agent uses rows as items directly; just guarantee a stable id.
  return rows.map((r) => ({ ...r, id: r.id || r.contact_email }));
}

module.exports = { fetchLeads };
