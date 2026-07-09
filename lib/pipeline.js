// Draft logic for the Pipeline Builder, used by the Vercel endpoints.
// Reuses the tested guardrail modules from agent-lab (pure JS, no fs at load).

const { createLLM } = require("../agent-lab/packages/agent-core/llm");
const {
  selectProspects,
  addDays,
} = require("../agent-lab/agents/pipeline-builder/eligibility");
const {
  buildFooter,
  checkCompliance,
} = require("../agent-lab/agents/pipeline-builder/compliance");
const schema = require("../agent-lab/agents/pipeline-builder/schema");

const SYSTEM_PROMPT = `You are the Pipeline Builder Agent for Electric Nerdz.

Your job: write one short, personalized outreach email (or the correct follow-up)
for ONE prospect, using the business context provided.

Electric Nerdz installs small AI action agents for repeatable business chores:
lead follow-up, no-show recovery, review requests, weekly reports, and admin
handoffs. Not chatbots — agents that read the work, draft or update the next
step, ask for approval when needed, and log what happened.

Return: offerAngle (which chore fits their visible pain), specificObservation (a
concrete, real detail — never invented), relevantPainPoint, fitScore (0-100),
emailSubject (a short, plain subject line), and emailBody (the message).

Rules:
- Short. Body under ~160 words. Plain, human, no hype.
- Include the site link: https://electricnerdz.biz
- touch "first": introduce ENZ + the angle, end with a light question.
- touch "follow_up": brief, reference the prior note, offer one small starting point.
- Do NOT write an unsubscribe line, signature, or postal address — the system
  appends the required compliant footer automatically.
- No misleading subjects (no fake Re:/Fwd:, no ALL CAPS, no !!!).
- Never promise or guarantee results.`;

function config() {
  return {
    senderEmail: process.env.OUTREACH_FROM || "jaron@electricnerdz.biz",
    ownerEmail: process.env.OUTREACH_OWNER || process.env.LEAD_NOTIFY_TO || "jaron@electricnerdz.biz",
    companyName: "Electric Nerdz",
    siteUrl: "https://electricnerdz.biz",
    optOutMailto: process.env.OUTREACH_OPTOUT || "unsubscribe@electricnerdz.biz",
    postalAddress:
      process.env.OUTREACH_POSTAL_ADDRESS ||
      "Electric Nerdz, 4141 Pennsylvania Ave, Suite 203, Kansas City, MO 64111",
    dailyCap: Number(process.env.OUTREACH_DAILY_CAP || 15),
    maxFollowUps: 2,
    followUpDelaysDays: [3, 6],
  };
}

function firstName(row) {
  const n = String(row.contact_name || "").trim();
  return n ? n.split(/\s+/)[0] : "there";
}

function formatProspect(row, kind) {
  return [
    `Touch: ${kind}`,
    `First name: ${firstName(row)}`,
    `Company: ${row.company || "(unknown)"}`,
    `Website: ${row.website || "(none)"}`,
    `Business type: ${row.business_type || "(unknown)"}`,
    `Observed pain signal: ${row.pain_signal || "(none provided)"}`,
    `Context / notes: ${row.notes || "(none)"}`,
  ].join("\n");
}

// Returns [{ prospect, action }] — actions are drafts; nothing is sent here.
async function draftOutreach(prospects, { llm, now } = {}) {
  const cfg = config();
  const _now = now || Date.now();
  const _llm = llm || createLLM();

  const { eligible } = selectProspects(prospects, cfg, _now);
  const out = [];

  for (const { row, kind } of eligible) {
    const decision = await _llm.decide({
      system: SYSTEM_PROMPT,
      prompt: formatProspect(row, kind),
      schema,
    });

    let body = String(decision.emailBody || "").trim();
    if (!/electricnerdz\.biz/i.test(body)) body += `\n\n${cfg.siteUrl}`;
    body += "\n" + buildFooter(cfg);

    const email = { subject: decision.emailSubject, body };
    const compliance = checkCompliance(email, cfg);

    const sentCount = Number(row.sent_count || 0);
    const [d1, d2] = cfg.followUpDelaysDays;
    let followUpDate = null;
    if (kind === "first") {
      followUpDate = new Date(addDays(_now, d1)).toISOString().slice(0, 10);
    } else if (sentCount < cfg.maxFollowUps) {
      followUpDate = new Date(addDays(_now, d2)).toISOString().slice(0, 10);
    }

    out.push({
      prospect: row,
      action: {
        from: cfg.senderEmail,
        to: row.email,
        touch: kind,
        subject: email.subject,
        body: email.body,
        offerAngle: decision.offerAngle,
        fitScore: decision.fitScore ?? null,
        cleared: compliance.ok,
        compliance,
        followUpDate,
      },
    });
  }

  return out;
}

module.exports = { draftOutreach, config };
