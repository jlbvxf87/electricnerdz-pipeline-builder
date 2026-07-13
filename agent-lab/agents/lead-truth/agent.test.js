// Offline test of the full Lead Truth loop — mock LLM, no network, no keys.
// Covers: honest verdicts, the send/skip split, the stop sign, and delivery
// through the shared approve step.

const { test } = require("node:test");
const assert = require("node:assert");

const {
  runAgent,
  createMemoryStore,
  createDryRunSender,
  approveAndSend,
} = require("../../packages/agent-core");
const agent = require("./agent");
const fixtures = require("./fixtures/sample-leads.json");

// Deterministic mock keyed off the fixture content:
//   lead_001 detailed pain  -> pursue (+ draft)
//   lead_002 "i love ai"    -> nurture (+ draft)
//   lead_003 test entry     -> skip (no draft)
const mockLLM = {
  provider: "mock",
  async decide({ prompt }) {
    if (prompt.includes("30 minutes per lead")) {
      return {
        summary: "Real operator with a concrete 30-min-per-lead admin problem.",
        qualityScore: 84,
        verdict: "pursue",
        reasons: ["Specific, operational pain in their own words", "Direct fit for an intake agent"],
        nextStep: "Reply today and offer a 15-minute call.",
        followUpEmail: {
          subject: "Your 30-minutes-per-lead problem",
          body: "Hi — you mentioned every inquiry costs you 30 minutes of manual entry. That's exactly the chore our intake agent handles. Worth a 15-minute call?\n\nJaron — Electric Nerdz",
        },
      };
    }
    if (prompt.includes("i love ai")) {
      return {
        summary: "Probably real but gave nothing to work with; platform score of 72 overstates it.",
        qualityScore: 38,
        verdict: "nurture",
        reasons: ["Vague one-liner, no concrete pain", "Platform score not supported by content"],
        nextStep: "Send a light one-question reply; do not book a call yet.",
        followUpEmail: {
          subject: "Quick question about your admin load",
          body: "Hi Mike — what's the one admin task that eats the most of your week? One line back is plenty.\n\nJaron — Electric Nerdz",
        },
      };
    }
    return {
      summary: "Form-delivery test entry, not a lead; platform still scored it 63.",
      qualityScore: 2,
      verdict: "skip",
      reasons: ["Explicitly says it is a test of the lead form", "Platform score of 63 is noise"],
      nextStep: "Ignore; consider filtering test submissions upstream.",
      followUpEmail: { subject: "", body: "" },
    };
  },
};

test("verdicts split correctly: pursue/nurture are gated sends, skip is log-only", async () => {
  const store = createMemoryStore();
  const run = await runAgent(agent, { store, llm: mockLLM, items: fixtures.items });

  assert.equal(run.results.length, 3);
  const [pursue, nurture, skip] = run.results;

  assert.equal(pursue.action.kind, "send_email");
  assert.equal(pursue.action.cleared, true);
  assert.ok(pursue.approval, "pursue lead awaits approval");
  assert.equal(pursue.approval.status, "pending");
  assert.equal(pursue.action.sent, false);

  assert.equal(nurture.action.kind, "send_email");
  assert.ok(nurture.approval, "nurture lead awaits approval");

  assert.equal(skip.action.kind, "log_assessment");
  assert.equal(skip.approval, null, "skip creates no approval");
  assert.equal(skip.action.cleared, false);
});

test("the agent's own score is recorded next to the platform's claim", async () => {
  const store = createMemoryStore();
  const run = await runAgent(agent, { store, llm: mockLLM, items: fixtures.items });

  const nurture = run.results[1];
  assert.equal(nurture.action.qualityScore, 38);
  assert.equal(nurture.action.platformScore, 72, "keeps the claim for comparison");

  const skip = run.results[2];
  assert.equal(skip.action.qualityScore, 2);
  assert.equal(skip.action.platformScore, 63);
});

test("approved pursue lead delivers through the shared send step", async () => {
  const store = createMemoryStore();
  const run = await runAgent(agent, { store, llm: mockLLM, items: fixtures.items });
  const sender = createDryRunSender();

  const pursue = run.results[0];
  const res = await approveAndSend({ store, approvalId: pursue.approval.id, sender });

  assert.equal(res.ok, true);
  assert.equal(sender._outbox().length, 1);
  assert.equal(sender._outbox()[0].to, "owner@brightpath-plumbing.example");
  assert.match(sender._outbox()[0].text, /30 minutes/);
});

test("a pursue verdict without a usable email is never cleared", async () => {
  const store = createMemoryStore();
  const noEmail = [{ ...fixtures.items[0], contact_email: "" }];
  const run = await runAgent(agent, { store, llm: mockLLM, items: noEmail });
  const sender = createDryRunSender();

  const r = run.results[0];
  assert.equal(r.action.cleared, false);
  assert.ok(r.approval, "still surfaces for the owner to see");

  const res = await approveAndSend({ store, approvalId: r.approval.id, sender });
  assert.equal(res.ok, false, "deliver hard-gate blocks it");
  assert.equal(sender._outbox().length, 0);
});
