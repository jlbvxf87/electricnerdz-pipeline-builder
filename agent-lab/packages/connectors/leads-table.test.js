// Offline test for the leads-table connector — mock fetch, no network.

const { test } = require("node:test");
const assert = require("node:assert");
const { fetchLeads, markLeadsAssessed } = require("./leads-table");

test("fetchLeads queries new leads with a limit and returns rows as items", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      json: async () => [
        { id: "uuid-1", contact_email: "a@b.co", status: "new" },
        { contact_email: "no-id@b.co", status: "new" },
      ],
    };
  };

  const items = await fetchLeads({
    url: "https://fake.supabase.co",
    serviceRoleKey: "srk",
    limit: 5,
    fetchImpl,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/leads\?/);
  assert.match(calls[0].url, /status=eq\.new/);
  assert.match(calls[0].url, /limit=5/);
  assert.match(calls[0].url, /order=created_at\.desc/);
  assert.match(calls[0].url, /lead_truth_at=is\.null/, "never re-judges assessed leads");
  assert.equal(calls[0].opts.headers.apikey, "srk");

  assert.equal(items.length, 2);
  assert.equal(items[0].id, "uuid-1");
  assert.equal(items[1].id, "no-id@b.co", "falls back to email for a stable id");
});

test("fetchLeads throws clearly without credentials", async () => {
  await assert.rejects(
    () => fetchLeads({ url: "", serviceRoleKey: "", fetchImpl: async () => ({}) }),
    /SUPABASE_URL/
  );
});

test("markLeadsAssessed stamps each judged lead with verdict + honest score", async () => {
  const patches = [];
  const fetchImpl = async (url, opts) => {
    patches.push({ url, method: opts.method, body: JSON.parse(opts.body) });
    return { ok: true, text: async () => "" };
  };

  const results = [
    { item: { id: "lead-1" }, action: { verdict: "pursue", qualityScore: 72 } },
    { item: { id: "lead-2" }, action: { verdict: "skip", qualityScore: 2 } },
    { item: {} }, // no id -> skipped, never throws
  ];

  const marked = await markLeadsAssessed(results, {
    url: "https://fake.supabase.co",
    serviceRoleKey: "srk",
    fetchImpl,
    now: () => "2026-07-12T00:00:00.000Z",
  });

  assert.deepEqual(marked, ["lead-1", "lead-2"]);
  assert.equal(patches.length, 2);
  assert.match(patches[0].url, /leads\?id=eq\.lead-1/);
  assert.equal(patches[0].method, "PATCH");
  assert.equal(patches[0].body.lead_truth_verdict, "pursue");
  assert.equal(patches[0].body.lead_truth_score, 72);
  assert.equal(patches[0].body.lead_truth_at, "2026-07-12T00:00:00.000Z");
  assert.equal(patches[1].body.lead_truth_verdict, "skip");
});

test("markLeadsAssessed is best-effort: one failed PATCH never blocks the rest", async () => {
  let n = 0;
  const fetchImpl = async () => {
    n++;
    if (n === 1) throw new Error("network blip");
    return { ok: true, text: async () => "" };
  };
  const marked = await markLeadsAssessed(
    [
      { item: { id: "bad" }, action: { verdict: "skip", qualityScore: 1 } },
      { item: { id: "good" }, action: { verdict: "pursue", qualityScore: 80 } },
    ],
    { url: "https://fake.supabase.co", serviceRoleKey: "srk", fetchImpl }
  );
  assert.deepEqual(marked, ["good"]);
});
