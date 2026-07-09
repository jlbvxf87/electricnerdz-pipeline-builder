// Offline test of the full Read -> Decide -> Act -> Approve -> Log loop.
// A mock llm stands in for Anthropic so this runs with no API key and no network.
// This IS the "test with fake data" step from the install flow.

const { test } = require("node:test");
const assert = require("node:assert");

const { runAgent, createMemoryStore } = require("../../packages/agent-core");
const agent = require("./agent");
const fixtures = require("./fixtures/sample-notes.json");

// Deterministic mock: returns a schema-shaped decision so we can assert the
// runtime's behavior (drafting, task extraction, and the stop sign) precisely.
const mockLLM = {
  provider: "mock",
  async decide({ prompt }) {
    const isAcme = prompt.includes("Acme");
    return {
      summary: isAcme
        ? "Kickoff with Acme to scope a Starter Install for missed after-hours leads."
        : "Weekly sync with Riverside Dental about no-show reporting and reminders.",
      followUpEmail: {
        subject: isAcme
          ? "Follow-up: Acme install kickoff"
          : "Follow-up: Riverside weekly sync",
        body: "Thanks for the time today. Here's a quick recap and the next steps we agreed on.",
      },
      tasks: isAcme
        ? [
            { owner: "Marco (EN)", title: "Send SOW to Acme", due: "2026-07-10" },
            { owner: "Dana (Acme)", title: "Share Google Ads access" },
          ]
        : [{ owner: "Sam (EN)", title: "Check whether Dentrix has an API" }],
      openQuestions: isAcme ? [] : ["Does Dentrix expose an API for reminders?"],
      decisions: isAcme
        ? ["Start with a Starter Install ($750)", "No auto-texting without approval"]
        : ["Owner sign-off needed before committing budget"],
    };
  },
};

test("drafts an email + tasks and gates sending behind human approval", async () => {
  const store = createMemoryStore();
  const run = await runAgent(agent, {
    store,
    llm: mockLLM,
    items: fixtures.items,
  });

  // Processed every meeting.
  assert.equal(run.results.length, fixtures.items.length);

  const first = run.results[0];

  // Draft/Act produced a real email + task list.
  assert.ok(first.action.draft.subject, "email has a subject");
  assert.ok(first.action.draft.body, "email has a body");
  assert.ok(Array.isArray(first.action.tasks) && first.action.tasks.length > 0, "has tasks");

  // Stop sign: sending requires approval, and nothing was actually sent.
  assert.ok(first.approval, "an approval was created for the send action");
  assert.equal(first.approval.status, "pending");
  assert.equal(first.action.sent, false);
});

test("logs the full Read/Decide/Act/Log sequence", async () => {
  const store = createMemoryStore();
  await runAgent(agent, { store, llm: mockLLM, items: fixtures.items });

  const { logs, approvals } = store._dump();
  const steps = new Set(logs.map((l) => l.step));

  for (const step of ["read", "decide", "act", "await_approval", "log"]) {
    assert.ok(steps.has(step), `logged step: ${step}`);
  }
  // One pending approval per meeting (both create a send_email action).
  assert.equal(approvals.length, fixtures.items.length);
  assert.ok(approvals.every((a) => a.status === "pending"));
});

test("approving a pending action flips its status", async () => {
  const store = createMemoryStore();
  const run = await runAgent(agent, { store, llm: mockLLM, items: fixtures.items });

  const approvalId = run.results[0].approval.id;
  const updated = await store.setApprovalStatus(approvalId, "approved");

  assert.equal(updated.status, "approved");
});
