// Meeting Follow-Up Agent — the reference implementation of the five-step shape.
// Read -> Decide -> Draft/Act -> (stop sign) -> Log is orchestrated by agent-core.

const fs = require("node:fs");
const path = require("node:path");
const manifest = require("./manifest.json");
const schema = require("./schema");

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, "prompt.md"), "utf8");

// READ: pull the work. In tests/dev we pass items via ctx; in prod a connector
// (e.g. a notes/transcript source) would supply them.
async function read(ctx) {
  if (ctx && Array.isArray(ctx.items)) return ctx.items;
  const fixtures = require("./fixtures/sample-notes.json");
  return fixtures.items;
}

function formatNotes(item) {
  const attendees = (item.attendees || []).join(", ");
  return [
    `Meeting: ${item.title || "(untitled)"}`,
    `Date: ${item.date || "(unknown)"}`,
    `Attendees: ${attendees || "(unknown)"}`,
    "",
    "Raw notes:",
    item.notes || "(no notes provided)",
  ].join("\n");
}

// DECIDE: one structured LLM call.
async function decide(item, ctx) {
  return ctx.llm.decide({
    system: SYSTEM_PROMPT,
    prompt: formatNotes(item),
    schema,
  });
}

// DRAFT/ACT: assemble the proposed action. Nothing is sent here.
async function act(item, decision) {
  return {
    kind: "send_email",
    to: item.attendees || [],
    draft: decision.followUpEmail,
    tasks: decision.tasks || [],
    openQuestions: decision.openQuestions || [],
    decisions: decision.decisions || [],
    sent: false, // stays false until a human approves and a sender acts
  };
}

// STOP SIGN: never send an email without a human approving it first.
function needsApproval(action) {
  return action.kind === "send_email";
}

module.exports = { manifest, read, decide, act, needsApproval };
