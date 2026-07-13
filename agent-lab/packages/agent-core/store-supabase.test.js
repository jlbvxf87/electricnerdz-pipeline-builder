// Offline tests for the Supabase store + notify + the full approval loop.
// A ~50-line fake PostgREST stands in for Supabase, so this runs with no
// network and no keys — same policy as every other test in the repo.

const { test } = require("node:test");
const assert = require("node:assert");

const { createSupabaseStore } = require("./store-supabase");
const { notifyApproval } = require("./notify");
const { approveAndSend } = require("./deliver");
const { createDryRunSender } = require("./senders");

// --- minimal PostgREST fake -------------------------------------------------
function fakeSupabase() {
  const tables = { agent_runs: [], agent_logs: [], agent_approvals: [] };
  let seq = 0;

  function parse(pathAndQuery) {
    const [path, query = ""] = pathAndQuery.split("?");
    const filters = {};
    for (const part of query.split("&")) {
      const m = part.match(/^([a-z_]+)=eq\.(.*)$/);
      if (m) filters[m[1]] = decodeURIComponent(m[2]);
    }
    return { table: path, filters };
  }

  const fetchImpl = async (url, init = {}) => {
    const { table, filters } = parse(url.replace(/^https?:\/\/[^/]+\/rest\/v1\//, ""));
    const rows = tables[table];
    if (!rows) return { ok: false, status: 404, text: async () => `no table ${table}` };

    const match = (r) => Object.entries(filters).every(([k, v]) => String(r[k]) === v);
    const respond = (body, status = 200) => ({
      ok: true,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });

    if (init.method === "POST") {
      const row = { id: `id_${++seq}`, created_at: new Date().toISOString(), ...JSON.parse(init.body) };
      rows.push(row);
      // Real PostgREST returns the row ONLY when return=representation is asked
      // for; otherwise it's 201 with an EMPTY body (this is what broke appendLog).
      const wantsRep = /return=representation/.test((init.headers && init.headers.Prefer) || "");
      if (!wantsRep) {
        return { ok: true, status: 201, json: async () => { throw new Error("empty body"); }, text: async () => "" };
      }
      return respond([row], 201);
    }
    if (init.method === "PATCH") {
      const patch = JSON.parse(init.body);
      const hits = rows.filter(match);
      hits.forEach((r) => Object.assign(r, patch));
      return respond(hits);
    }
    return respond(rows.filter(match));
  };

  return { tables, fetchImpl };
}

function makeStore(fake) {
  return createSupabaseStore({
    url: "https://fake.supabase.co",
    serviceRoleKey: "test-key",
    fetchImpl: fake.fetchImpl,
  });
}

// --- tests --------------------------------------------------------------------

test("supabase store: createApproval persists with approve + reject tokens", async () => {
  const fake = fakeSupabase();
  const store = makeStore(fake);

  const approval = await store.createApproval({
    runId: "run_1",
    agent: "meeting-follow-up",
    itemId: "mtg_001",
    action: { kind: "send_email", cleared: true, to: ["a@b.co"] },
  });

  assert.ok(approval.id);
  assert.equal(approval.status, "pending");
  assert.ok(approval.approveToken && approval.approveToken.length > 20);
  assert.ok(approval.rejectToken && approval.rejectToken.length > 20);
  assert.notEqual(approval.approveToken, approval.rejectToken);
  assert.equal(fake.tables.agent_approvals.length, 1);
});

test("supabase store: token lookup, status update, and filtered listing", async () => {
  const fake = fakeSupabase();
  const store = makeStore(fake);

  const a = await store.createApproval({ agent: "x", action: { kind: "send_email" } });

  const byToken = await store.findApprovalByToken(a.approveToken, "approve");
  assert.equal(byToken.id, a.id);

  await store.setApprovalStatus(a.id, "rejected");
  const after = await store.getApproval(a.id);
  assert.equal(after.status, "rejected");
  assert.ok(after.decided_at);

  const pending = await store.listApprovals({ status: "pending" });
  assert.equal(pending.length, 0);
});

test("full loop on supabase store: run -> notify -> approve link -> dry-run send", async () => {
  const fake = fakeSupabase();
  const store = makeStore(fake);
  const { runAgent } = require("./runner");
  const agent = require("../../agents/meeting-follow-up/agent");

  const mockLLM = {
    async decide() {
      return {
        summary: "s",
        followUpEmail: { subject: "Recap", body: "Thanks for the time today." },
        tasks: [], openQuestions: [], decisions: [],
      };
    },
  };

  const run = await runAgent(agent, { store, llm: mockLLM });
  const approval = run.results[0].approval;
  assert.equal(approval.status, "pending");
  assert.ok(approval.approveToken, "supabase approvals carry one-click tokens");

  // Notify on both channels (mock fetch records the calls).
  const sent = [];
  const notifyFetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({}) };
  };
  const n = await notifyApproval({
    approval,
    baseUrl: "https://electricnerdz.biz",
    ownerEmail: "owner@example.com",
    resendApiKey: "rk",
    telegramToken: "tt",
    telegramChatId: "42",
    fetchImpl: notifyFetch,
  });
  assert.equal(n.email.ok, true);
  assert.equal(n.telegram.ok, true);
  assert.ok(sent[0].body.html.includes(`token=${approval.approveToken}`));
  assert.ok(sent[1].body.text.includes(`token=${approval.rejectToken}`));

  // Simulate clicking Approve: token lookup -> approveAndSend -> mark sent.
  const found = await store.findApprovalByToken(approval.approveToken, "approve");
  const sender = createDryRunSender();
  const res = await approveAndSend({ store, approvalId: found.id, sender });
  assert.equal(res.ok, true);
  assert.equal(sender._outbox().length, 1);

  // Rejected approvals can never send.
  const b = await store.createApproval({ agent: "x", action: { kind: "send_email", cleared: true, to: ["a@b.co"] } });
  await store.setApprovalStatus(b.id, "rejected");
  const blocked = await approveAndSend({ store, approvalId: b.id, sender });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "rejected");
  assert.equal(sender._outbox().length, 1, "nothing extra was sent");
});

test("notify: a non-cleared action gets a blocked notice, no approve link", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({}) };
  };
  await notifyApproval({
    approval: {
      agent: "meeting-follow-up",
      itemId: "mtg_x",
      approveToken: "AT",
      rejectToken: "RT",
      action: { kind: "send_email", cleared: false, to: [], draft: { subject: "s", body: "b" } },
    },
    baseUrl: "https://x.co",
    ownerEmail: "o@x.co",
    resendApiKey: "rk",
    fetchImpl,
  });
  assert.ok(calls[0].html.includes("Blocked"));
  assert.ok(!calls[0].html.includes("token=AT"), "no approve link for uncleared actions");
});
