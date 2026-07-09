// Pipeline Builder configuration and safety limits.
// Injectable via ctx.config in tests; falls back to these defaults.

module.exports = {
  senderEmail: "jaron@electricnerdz.biz",
  ownerEmail: "jaron@electricnerdz.biz",
  companyName: "Electric Nerdz",
  siteUrl: "https://electricnerdz.biz",
  optOutMailto: "unsubscribe@electricnerdz.biz",

  // REQUIRED by CAN-SPAM: every commercial email must include a valid physical
  // postal address. Set OUTREACH_POSTAL_ADDRESS in the environment (Vercel).
  // Until it's a real address, the compliance check FAILS on purpose and the
  // agent will not clear anything to send.
  postalAddress:
    process.env.OUTREACH_POSTAL_ADDRESS ||
    "Electric Nerdz, 4141 Pennsylvania Ave, Suite 203, Kansas City, MO 64111",

  // Deliverability guardrails — keep the beta far below Workspace limits.
  dailyCap: 15, // 10–25 highly personalized emails/day
  maxFollowUps: 2, // stop after 2 follow-ups
  followUpDelaysDays: [3, 6], // FU1 +3d, FU2 +6d

  // V1 behavior. "draft" = draft only, always approval-gated.
  // Stages: "draft" -> "approve" -> "auto" (auto only for approved lists, capped).
  mode: "draft",
};
