// Run an agent on the shared layer. POST your items (e.g. meeting notes),
// the agent drafts via Claude, every gated action lands as a pending approval
// in Supabase, and you get Approve/Reject links by email + Telegram.
// Nothing sends without a click.
//
//   POST /api/agent-run?secret=...        (or Vercel cron Bearer)
//   { "agent": "meeting-follow-up",
//     "items": [{ "id": "mtg_1", "title": "...", "attendees": [...],
//                 "attendee_emails": ["dana@acme.com"], "notes": "..." }] }
//
// Only allowlisted agents can run — the pipeline-builder keeps its own path.

const {
  runAgent,
  createSupabaseStore,
  createLLM,
  notifyApproval,
} = require("../agent-lab/packages/agent-core");
const { json, baseUrl, authorized } = require("../lib/pipeline-db");

const AGENTS = {
  "meeting-follow-up": {
    load: () => require("../agent-lab/agents/meeting-follow-up/agent"),
  },
  "lead-truth": {
    load: () => require("../agent-lab/agents/lead-truth/agent"),
    // No items posted? Read new leads from our own Supabase table.
    defaultItems: async (body) => {
      const { fetchLeads } = require("../agent-lab/packages/connectors/leads-table");
      return fetchLeads({
        status: body.status || "new",
        limit: Number(body.limit) || 20,
      });
    },
  },
};

async function readBody(req) {
  if (req.body) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

module.exports = async function handler(req, res) {
  if (!authorized(req)) return json(res, 401, { ok: false, error: "Unauthorized" });
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) {
    return json(res, 500, { ok: false, error: "ANTHROPIC_API_KEY is not set." });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { ok: false, error: "Invalid JSON body." });
  }

  const name = body.agent || "meeting-follow-up";
  const entry = AGENTS[name];
  if (!entry) {
    return json(res, 400, {
      ok: false,
      error: `Unknown agent "${name}". Available: ${Object.keys(AGENTS).join(", ")}`,
    });
  }

  let items = Array.isArray(body.items) ? body.items : null;
  if ((!items || items.length === 0) && entry.defaultItems) {
    try {
      items = await entry.defaultItems(body);
    } catch (err) {
      return json(res, 500, { ok: false, error: `Reading default items failed: ${err.message}` });
    }
  }
  if (!items || items.length === 0) {
    return json(res, 400, {
      ok: false,
      error: entry.defaultItems
        ? "No items posted and no matching rows found to read."
        : "Provide items: a non-empty array.",
    });
  }

  try {
    const agent = entry.load();
    const store = createSupabaseStore();
    const llm = createLLM();

    const run = await runAgent(agent, { store, llm, items });

    const base = baseUrl(req);
    const notified = [];
    for (const r of run.results) {
      if (!r.approval) continue;
      const n = await notifyApproval({ approval: r.approval, baseUrl: base });
      notified.push({ approvalId: r.approval.id, ...n });
    }

    return json(res, 200, {
      ok: true,
      runId: run.runId,
      agent: name,
      items: run.count,
      pendingApprovals: notified.length,
      notified,
    });
  } catch (err) {
    return json(res, 500, { ok: false, error: String(err.message || err) });
  }
};
