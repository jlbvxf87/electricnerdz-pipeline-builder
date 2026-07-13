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
// `to` must be real email addresses (item.attendee_emails) — attendee display
// names are kept separately for the approval UI. This is a warm, relationship
// email to people who were in the meeting (not commercial cold outreach), so
// it is compliance-cleared by construction — but ONLY when there's at least
// one valid recipient address. The human-approval stop sign still applies.
async function act(item, decision, ctx) {
  const to = (item.attendee_emails || []).filter((e) => /\S+@\S+\.\S+/.test(e));
  return {
    kind: "send_email",
    from: (ctx && ctx.config && ctx.config.senderEmail) || undefined,
    to,
    attendees: item.attendees || [],
    draft: decision.followUpEmail,
    tasks: decision.tasks || [],
    openQuestions: decision.openQuestions || [],
    decisions: decision.decisions || [],
    cleared: to.length > 0, // deliver.js hard gate: no recipients -> never sends
    sent: false, // stays false until a human approves and a sender acts
  };
}

// STOP SIGN: never send an email without a human approving it first.
function needsApproval(action) {
  return action.kind === "send_email";
}

module.exports = { manifest, read, decide, act, needsApproval };
