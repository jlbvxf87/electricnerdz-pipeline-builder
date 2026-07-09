// CAN-SPAM compliance, enforced as code. An email is only "cleared" to send
// if it passes every check. The agent-core stop sign still requires a human
// approval on top of this in V1.
//
// Reference: FTC CAN-SPAM guidance — no false/misleading headers, no deceptive
// subject lines, a valid physical postal address, and a clear opt-out.

const MISLEADING_SUBJECT_PATTERNS = [
  /^\s*re:/i, // faking a reply thread
  /^\s*fwd:/i, // faking a forward
  /free money/i,
  /!!!/,
  /100%\s*free/i,
  /act now/i,
];

const RESULT_PROMISE_PATTERNS = [
  /guarantee/i,
  /guaranteed/i,
  /\bdouble your\b/i,
  /\b\d+\s*x\s*(your\s*)?(revenue|leads|sales|roi)\b/i,
  /we promise/i,
  /risk[-\s]?free/i,
];

function buildFooter(config) {
  return [
    "",
    "—",
    `${config.companyName} · ${config.siteUrl}`,
    config.postalAddress,
    `Don't want these emails? Reply "unsubscribe" or email ${config.optOutMailto} and we'll stop immediately.`,
  ].join("\n");
}

function checkCompliance(email, config) {
  const violations = [];
  const subject = String(email.subject || "");
  const body = String(email.body || "");

  if (!subject.trim()) violations.push("empty_subject");
  if (MISLEADING_SUBJECT_PATTERNS.some((r) => r.test(subject))) {
    violations.push("misleading_subject");
  }

  // Must identify the sender/business + link.
  if (!/electricnerdz\.biz/i.test(body)) violations.push("missing_site_link");

  // Must include a clear opt-out mechanism.
  const hasOptOut =
    /unsubscribe/i.test(body) ||
    (config.optOutMailto && body.includes(config.optOutMailto));
  if (!hasOptOut) violations.push("missing_opt_out");

  // Must include a valid physical postal address.
  if (!body.includes(config.postalAddress)) violations.push("missing_postal_address");
  if (/\[ADD YOUR POSTAL ADDRESS/i.test(body)) violations.push("placeholder_address");

  // No promising results.
  if (RESULT_PROMISE_PATTERNS.some((r) => r.test(body))) violations.push("promises_results");

  return { ok: violations.length === 0, violations };
}

module.exports = { buildFooter, checkCompliance };
