// Offline test for the leads-table connector — mock fetch, no network.

const { test } = require("node:test");
const assert = require("node:assert");
const { fetchLeads } = require("./leads-table");

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
