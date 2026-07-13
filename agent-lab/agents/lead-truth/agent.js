// Lead Truth Agent — is this lead actually worth following up with?
// Read -> Decide -> Draft/Act -> (stop sign) -> Log, orchestrated by agent-core.
//
// Reads the business's OWN lead rows (Supabase `leads` table via the
// leads-table connector, or items passed in ctx). Claude gives an honest
// quality verdict — treating any platform/quiz score as a claim, not truth —
// and drafts a follow-up for real leads. Nothing sends without approval.

const fs = require("node:fs");
const path = require("node:path");
const manifest = require("./manifest.json");
const schema = require("./schema");

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, "prompt.md"), "utf8");

const DEFAULT_SENDER = "jaron@electricnerdz.biz";
const EMAIL_RE = /^\S+@\S+\.\S+$/;

// READ: ctx.items (tests / endpoint), then a connector, then fixtures.
async function read(ctx) {
  if (ctx && Array.isArray(ctx.items)) return ctx.items;
  if (ctx && ctx.connectors && typeof ctx.connectors.fetchLeads === "function") {
    return ctx.connectors.fetchLeads();
  }
  return require("./fixtures/sample-leads.json").items;
}

function ageInDays(createdAt, now = Date.now()) {
  const t = Date.parse(createdAt || "");
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((now - t) / 86400000));
}

function formatLead(item) {
  const age = ageInDays(item.created_at);
  return [
    `Lead status: ${item.status || "(unknown)"}`,
    `Source / campaign: ${item.source || "(unknown)"}`,
    `Age: ${age === null ? "(unknown)" : age + " day(s) old"}`,
    `Business type: ${item.business_type || "(unknown)"}`,
    `Interest area: ${item.nerd_type || "(unknown)"}`,
    `Problem in their words: ${item.primary_issue || "(blank)"}`,
    `Stated goal: ${item.goal || "(blank)"}`,
    `Contact email: ${item.contact_email || "(none)"}`,
    `ZIP: ${item.zip || "(blank)"}`,
    "",
    `Platform-claimed score (do not trust, verify): ${item.score ?? "(none)"}`,
    `Platform-claimed monthly loss: ${
      item.estimated_monthly_loss != null ? "$" + item.estimated_monthly_loss : "(none)"
    }`,
    `Platform-flagged leaks: ${
      Array.isArray(item.leaks) ? item.leaks.join(", ") : "(none)"
    }`,
  ].join("\n");
}

// DECIDE: one structured LLM call -> verdict + honest score + draft.
async function decide(item, ctx) {
  return ctx.llm.decide({
    system: SYSTEM_PROMPT,
    prompt: formatLead(item),
    schema,
  });
}

// DRAFT/ACT: assemble the proposed action. Nothing is sent here.
// pursue/nurture with a valid email -> a gated send_email action.
// skip (or no usable email/draft)   -> a log-only assessment, never sent.
async function act(item, decision, ctx) {
  const from = (ctx && ctx.config && ctx.config.senderEmail) || DEFAULT_SENDER;
  const to = String(item.contact_email || "").trim();
  const draft = decision.followUpEmail || {};
  const wantsSend = decision.verdict === "pursue" || decision.verdict === "nurture";
  const hasDraft = Boolean(draft.subject && draft.body);
  const validEmail = EMAIL_RE.test(to);

  const base = {
    leadId: item.id,
    verdict: decision.verdict,
    qualityScore: decision.qualityScore,
    platformScore: item.score ?? null,
    reasons: decision.reasons || [],
    nextStep: decision.nextStep || "",
    sent: false, // stays false until a human approves and a sender acts
    log: {
      lead: item.contact_email || item.id,
      verdict: decision.verdict,
      qualityScore: decision.qualityScore,
      platformScore: item.score ?? null,
      at: new Date().toISOString(),
    },
  };

  if (!wantsSend) {
    return { ...base, kind: "log_assessment", cleared: false };
  }

  return {
    ...base,
    kind: "send_email",
    from,
    to: validEmail ? to : "",
    draft: hasDraft ? { subject: draft.subject, body: draft.body } : null,
    // Warm inbound lead (they submitted the form) — cleared when there is a
    // real address AND a real draft. deliver.js hard-gates on this.
    cleared: validEmail && hasDraft,
  };
}

// STOP SIGN: any email requires a human approval; assessments are log-only.
function needsApproval(action) {
  return action.kind === "send_email";
}

module.exports = { manifest, read, decide, act, needsApproval };
