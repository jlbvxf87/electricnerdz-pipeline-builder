// Pipeline Builder Agent — V1 (draft-only, approval-gated).
// Read -> Decide -> Draft/Act -> Ask Approval -> Log, orchestrated by agent-core.
//
// Sources are APPROVED prospect rows (a Google Sheet / CSV export). This agent
// does NOT scrape LinkedIn or automate any site — it only reads rows you supply
// and public context you attach to them.

const fs = require("node:fs");
const path = require("node:path");
const manifest = require("./manifest.json");
const schema = require("./schema");
const defaultConfig = require("./config");
const { selectProspects, addDays } = require("./eligibility");
const { buildFooter, checkCompliance } = require("./compliance");

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, "prompt.md"), "utf8");

function firstName(row) {
  const n = String(row.contact_name || "").trim();
  return n ? n.split(/\s+/)[0] : "there";
}

// READ: select who we're allowed to contact today (eligibility enforced here).
async function read(ctx) {
  const config = ctx.config || defaultConfig;
  const now = ctx.now || Date.now();
  const rows = Array.isArray(ctx.items)
    ? ctx.items
    : require("./fixtures/prospects.json").rows;

  const { eligible, skipped } = selectProspects(rows, config, now);
  ctx._skipped = skipped; // available for logging by the caller

  return eligible.map((e) => ({
    id: e.row.company || e.row.email,
    row: e.row,
    kind: e.kind,
  }));
}

function formatProspect(item) {
  const r = item.row;
  return [
    `Touch: ${item.kind}`,
    `First name: ${firstName(r)}`,
    `Company: ${r.company || "(unknown)"}`,
    `Website: ${r.website || "(none)"}`,
    `Business type: ${r.business_type || "(unknown)"}`,
    `Observed pain signal: ${r.pain_signal || "(none provided)"}`,
    `Context / notes: ${r.notes || "(none)"}`,
  ].join("\n");
}

// DECIDE: one structured LLM call → angle + personalized email.
async function decide(item, ctx) {
  return ctx.llm.decide({
    system: SYSTEM_PROMPT,
    prompt: formatProspect(item),
    schema,
  });
}

// DRAFT/ACT: append the compliant footer, run compliance, schedule follow-up,
// build the owner alert and the log line. Nothing is sent.
async function act(item, decision, ctx) {
  const config = ctx.config || defaultConfig;
  const now = ctx.now || Date.now();
  const row = item.row;

  let body = String(decision.email.body || "").trim();
  if (!/electricnerdz\.biz/i.test(body)) body += `\n\n${config.siteUrl}`;
  body += "\n" + buildFooter(config);

  const email = { subject: decision.email.subject, body };
  const compliance = checkCompliance(email, config);

  const sentCount = Number(row.sent_count || 0);
  const [firstDelay, secondDelay] = config.followUpDelaysDays;
  let followUpDate = null;
  if (item.kind === "first") {
    followUpDate = new Date(addDays(now, firstDelay)).toISOString().slice(0, 10);
  } else if (sentCount < 1 + config.maxFollowUps - 1) {
    // there's still a follow-up left after this one
    followUpDate = new Date(addDays(now, secondDelay)).toISOString().slice(0, 10);
  }

  return {
    kind: "send_email",
    mode: config.mode, // "draft" in V1
    from: config.senderEmail,
    to: row.email,
    prospect: row.company,
    touch: item.kind,
    offerAngle: decision.offerAngle,
    fitScore: decision.fitScore ?? null,
    draft: email,
    compliance,
    cleared: compliance.ok, // only true when fully CAN-SPAM compliant
    sent: false, // never sent in V1 — approval + a sender step required
    followUpDate,
    alert: {
      to: config.ownerEmail,
      text: `Pipeline Builder drafted a ${item.kind} email to ${row.company} <${row.email}> (angle: ${decision.offerAngle}). ${
        compliance.ok ? "Compliant — pending your approval." : "BLOCKED: " + compliance.violations.join(", ")
      }`,
    },
    log: {
      prospect: row.company,
      email: row.email,
      touch: item.kind,
      status: compliance.ok ? "drafted_pending_approval" : "blocked_compliance",
      violations: compliance.violations,
      followUpDate,
      at: new Date().toISOString(),
    },
  };
}

// STOP SIGN: V1 is draft-only — a human must approve before anything sends.
// Even later stages keep approval on until compliance.ok AND the list is trusted.
function needsApproval() {
  return true;
}

module.exports = { manifest, read, decide, act, needsApproval };
