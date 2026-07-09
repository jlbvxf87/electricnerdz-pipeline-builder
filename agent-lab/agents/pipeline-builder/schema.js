// Structured Decide output for the Pipeline Builder.
// The model returns the angle + a personalized email. The runtime appends the
// compliant footer and runs the compliance check — the model never controls
// the opt-out/address footer.
//
// NOTE: the email subject/body are TOP-LEVEL string fields (not a nested
// object). Flat fields populate reliably under forced tool use; a nested
// { subject, body } object was coming back empty on some models.

module.exports = {
  type: "object",
  properties: {
    summary: { type: "string" },
    offerAngle: {
      type: "string",
      description:
        "Which Electric Nerdz chore/offer best fits this prospect's visible pain (e.g. lead follow-up, no-show recovery, review requests, weekly reports, admin handoffs).",
    },
    specificObservation: {
      type: "string",
      description: "A concrete, real detail about the prospect used to personalize.",
    },
    relevantPainPoint: { type: "string" },
    fitScore: {
      type: "integer",
      description: "0–100: how likely this business needs an action agent.",
    },
    emailSubject: {
      type: "string",
      description: "The outreach email subject line. Must be a non-empty, plain, non-misleading subject.",
    },
    emailBody: {
      type: "string",
      description:
        "The full outreach email body (under ~160 words). Must be non-empty. Do NOT include an unsubscribe line, signature, or postal address — the system appends the compliant footer.",
    },
  },
  required: ["offerAngle", "fitScore", "emailSubject", "emailBody"],
};
