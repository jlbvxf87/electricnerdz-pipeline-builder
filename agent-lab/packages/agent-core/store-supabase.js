// Supabase-backed store — the production version of createMemoryStore().
// Same interface (saveRun, appendLog, createApproval, setApprovalStatus,
// listApprovals) plus getApproval(id) and findApprovalByToken(token) for the
// approve/reject endpoints. Server-side only: uses the service role key, which
// bypasses RLS (the tables deny all public access).
//
// Tables: agent_runs, agent_logs, agent_approvals
// (see supabase/2026_agent_approvals.sql in the site repo).

const crypto = require("node:crypto");

function createSupabaseStore(opts = {}) {
  const url = opts.url || process.env.SUPABASE_URL;
  const key = opts.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const _fetch = opts.fetchImpl || globalThis.fetch;

  async function sb(path, init = {}) {
    if (!url || !key) {
      throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.");
    }
    const res = await _fetch(`${url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    if (res.status === 204) return null;
    // A POST without Prefer:return=representation (e.g. appendLog) comes back
    // 201 with an EMPTY body — res.json() would throw "Unexpected end of JSON
    // input". Read text and parse only when there's something to parse.
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  function insert(table, body) {
    return sb(table, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
  }

  // DB row -> the shape agents/runner/deliver already use (camelCase).
  function toApproval(row) {
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      created_at: row.created_at,
      runId: row.run_id,
      agent: row.agent,
      itemId: row.item_id,
      action: row.action,
      approveToken: row.approve_token,
      rejectToken: row.reject_token,
      decided_at: row.decided_at,
      sent_at: row.sent_at,
      message_id: row.message_id,
    };
  }

  return {
    async saveRun(run) {
      await insert("agent_runs", {
        run_id: run.runId,
        agent: run.agent,
        started_at: run.startedAt,
        finished_at: run.finishedAt,
        count: run.count,
        results: run.results,
      });
      return run;
    },

    async appendLog(entry) {
      const { runId, agent, step, itemId, approvalId, ...rest } = entry;
      const record = {
        run_id: runId || null,
        agent: agent || null,
        step: step || null,
        item_id: itemId || null,
        approval_id: approvalId || null,
        entry: Object.keys(rest).length ? rest : null,
      };
      await sb("agent_logs", { method: "POST", body: JSON.stringify(record) });
      return { at: new Date().toISOString(), ...entry };
    },

    async createApproval(approval) {
      const rows = await insert("agent_approvals", {
        run_id: approval.runId || null,
        agent: approval.agent,
        item_id: approval.itemId || null,
        action: approval.action,
        status: "pending",
        approve_token: crypto.randomBytes(24).toString("base64url"),
        reject_token: crypto.randomBytes(24).toString("base64url"),
      });
      return toApproval(rows[0]);
    },

    async setApprovalStatus(id, status, extra = {}) {
      const patch = { status, decided_at: new Date().toISOString(), ...extra };
      const rows = await sb(`agent_approvals?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      return toApproval(rows && rows[0]);
    },

    async listApprovals(filter = {}) {
      const colMap = { runId: "run_id", itemId: "item_id" };
      const params = Object.entries(filter)
        .map(([k, v]) => `${colMap[k] || k}=eq.${encodeURIComponent(v)}`)
        .join("&");
      const rows = await sb(
        `agent_approvals?select=*${params ? "&" + params : ""}&order=created_at.desc`
      );
      return (rows || []).map(toApproval);
    },

    // Fast path used by deliver.js — avoids pulling the whole table.
    async getApproval(id) {
      const rows = await sb(
        `agent_approvals?id=eq.${encodeURIComponent(id)}&select=*`
      );
      return toApproval(rows && rows[0]);
    },

    // Token lookup for the one-click approve/reject endpoints.
    async findApprovalByToken(token, kind = "approve") {
      const col = kind === "reject" ? "reject_token" : "approve_token";
      const rows = await sb(
        `agent_approvals?${col}=eq.${encodeURIComponent(token)}&select=*`
      );
      return toApproval(rows && rows[0]);
    },
  };
}

module.exports = { createSupabaseStore };
