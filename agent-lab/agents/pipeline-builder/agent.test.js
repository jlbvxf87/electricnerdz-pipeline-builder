// Offline test of the Pipeline Builder guardrails and loop.
// A mock stands in for Claude, so this runs with no API key and no network.
// "now" is pinned so follow-up due-dates are deterministic.

const { test } = require("node:test");
const assert = require("node:assert");

const { runAgent, createMemoryStore } = require("../../packages/agent-core");
const agent = require("./agent");
const { selectProspects } = require("./eligibility");
const { checkCompliance, buildFooter } = require("./compliance");
const fixtures = require("./fixtures/prospects.json");

const NOW = Date.parse("2026-07-08T12:00:00Z");
const REAL_ADDR_CONFIG = {
  ...require("./config"),
  postalAddress: "Electric Nerdz, 123 Main St, Austin, TX 78701",
};

// Mock Claude: returns a compliant, personalized email (no footer — the agent
// appends the required footer itself).
const mockLLM = {
  provider: "mock",
  async decide({ prompt }) {
    const isFollowUp = /Touch:\s*follow_up/.test(prompt);
    const company = (prompt.match(/Company:\s*(.+)/) || [])[1] || "your business";
    return {
      summary: `Outreach to ${company}`,
      offerAngle: isFollowUp ? "review requests" : "lead follow-up",
      specificObservation: "your after-hours calls going to voicemail",
      relevantPainPoint: "missed leads",
      fitScore: 78,
      email: {
        subject: isFollowUp
          ? `Quick follow-up for ${company}`
          : `One small AI chore for ${company}`,
        body:
          `Hey there, I was looking at ${company} and noticed your after-hours calls going to voicemail. ` +
          `Electric Nerdz installs small AI action agents for repeatable chores. ` +
          `Here's the site: https://electricnerdz.biz — worth a quick look?`,
      },
    };
  },
};

test("eligibility: skips opt-outs, replies, not-due, and capped rows", () => {
  const config = require("./config");
  const { eligible, skipped } = selectProspects(fixtures.rows, config, NOW);

  const eligibleCompanies = eligible.map((e) => e.row.company).sort();
  assert.deepEqual(eligibleCompanies, ["Acme Plumbing", "GreenLeaf Landscaping"]);

  const reasons = Object.fromEntries(skipped.map((s) => [s.row.company, s.reason]));
  assert.equal(reasons["BrightSmile Dental"], "opted_out");
  assert.equal(reasons["Northside Law"], "reply_status:replied");
  assert.equal(reasons["Peak Fitness"], "not_due");
  assert.equal(reasons["Old Town Cafe"], "no_action");
});

test("kinds: Acme is a first touch, GreenLeaf is a follow-up", () => {
  const config = require("./config");
  const { eligible } = selectProspects(fixtures.rows, config, NOW);
  const byCompany = Object.fromEntries(eligible.map((e) => [e.row.company, e.kind]));
  assert.equal(byCompany["Acme Plumbing"], "first");
  assert.equal(byCompany["GreenLeaf Landscaping"], "follow_up");
});

test("a placeholder address FAILS compliance (safety guardrail)", () => {
  const config = {
    ...require("./config"),
    postalAddress: "Electric Nerdz, [ADD YOUR POSTAL ADDRESS HERE]",
  };
  const email = {
    subject: "Hello",
    body: "A body with https://electricnerdz.biz\n" + buildFooter(config),
  };
  const result = checkCompliance(email, config);
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes("placeholder_address"));
});

test("the real default address passes compliance", () => {
  const config = require("./config");
  const email = {
    subject: "One small AI chore",
    body: "A body with https://electricnerdz.biz\n" + buildFooter(config),
  };
  const result = checkCompliance(email, config);
  assert.deepEqual(result.violations, []);
  assert.equal(result.ok, true);
});

test("with a real postal address, a footered email is compliant", () => {
  const email = {
    subject: "One small AI chore",
    body: "Body with https://electricnerdz.biz\n" + buildFooter(REAL_ADDR_CONFIG),
  };
  const result = checkCompliance(email, REAL_ADDR_CONFIG);
  assert.deepEqual(result.violations, []);
  assert.equal(result.ok, true);
});

test("compliance catches misleading subjects and result-promises", () => {
  const good = "Body with https://electricnerdz.biz\n" + buildFooter(REAL_ADDR_CONFIG);
  assert.ok(
    checkCompliance({ subject: "Re: our chat", body: good }, REAL_ADDR_CONFIG)
      .violations.includes("misleading_subject")
  );
  const promise = "We guarantee we'll double your leads. https://electricnerdz.biz\n" + buildFooter(REAL_ADDR_CONFIG);
  assert.ok(
    checkCompliance({ subject: "Hello", body: promise }, REAL_ADDR_CONFIG)
      .violations.includes("promises_results")
  );
});

test("full loop: drafts are footered, gated behind approval, and never sent", async () => {
  const store = createMemoryStore();
  const run = await runAgent(agent, {
    store,
    llm: mockLLM,
    config: REAL_ADDR_CONFIG,
    now: NOW,
    items: fixtures.rows,
  });

  // Only the 2 eligible prospects were processed.
  assert.equal(run.results.length, 2);

  for (const r of run.results) {
    // Compliant footer content is present.
    assert.match(r.action.draft.body, /electricnerdz\.biz/);
    assert.match(r.action.draft.body, /unsubscribe/i);
    assert.match(r.action.draft.body, /Austin, TX/);

    assert.equal(r.action.cleared, true, "cleared compliance");
    assert.equal(r.action.sent, false, "never sent in V1");
    assert.ok(r.approval, "an approval was created");
    assert.equal(r.approval.status, "pending");
    assert.ok(r.action.alert.to, "owner alert present");
  }

  // First touch schedules FU1 (+3d); follow-up #1 schedules FU2 (+6d).
  const acme = run.results.find((r) => r.item.row.company === "Acme Plumbing");
  const greenleaf = run.results.find((r) => r.item.row.company === "GreenLeaf Landscaping");
  assert.equal(acme.action.followUpDate, "2026-07-11"); // +3 days
  assert.equal(greenleaf.action.followUpDate, "2026-07-14"); // +6 days, one follow-up left
});

test("sending from the configured owner address", async () => {
  const store = createMemoryStore();
  const run = await runAgent(agent, {
    store, llm: mockLLM, config: REAL_ADDR_CONFIG, now: NOW, items: fixtures.rows,
  });
  assert.ok(run.results.every((r) => r.action.from === "jaron@electricnerdz.biz"));
});
