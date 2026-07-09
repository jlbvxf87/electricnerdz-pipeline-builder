// Run an agent live against its fixtures using the real Anthropic Decide step.
// Requires ANTHROPIC_API_KEY in the environment.
//
//   ANTHROPIC_API_KEY=sk-ant-... node run.js
//
// Nothing is sent — every send action lands as a PENDING approval, exactly
// like production. This is the "go live with approval gates" behavior.

const { runAgent, createMemoryStore, createLLM } = require("./packages/agent-core");
const agent = require("./agents/meeting-follow-up/agent");
const fixtures = require("./agents/meeting-follow-up/fixtures/sample-notes.json");

(async () => {
  const store = createMemoryStore();
  const llm = createLLM();

  const run = await runAgent(agent, { store, llm, items: fixtures.items });

  for (const r of run.results) {
    console.log("\n=== " + r.item.title + " ===");
    console.log("SUMMARY:  ", r.decision.summary);
    console.log("SUBJECT:  ", r.action.draft.subject);
    console.log("EMAIL:\n" + r.action.draft.body);
    console.log("TASKS:    ", JSON.stringify(r.action.tasks, null, 2));
    if (r.action.openQuestions.length) {
      console.log("OPEN Qs:  ", r.action.openQuestions.join(" | "));
    }
    console.log(
      "APPROVAL: ",
      r.approval ? `${r.approval.status} (${r.approval.id}) — not sent` : "none"
    );
  }
})().catch((err) => {
  console.error("Run failed:", err.message);
  process.exit(1);
});
