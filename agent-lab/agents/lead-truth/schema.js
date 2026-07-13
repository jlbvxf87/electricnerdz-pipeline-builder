// Structured-output schema for the Lead Truth Decide step.
// Passed to the LLM as a tool input_schema so the result is always valid shape.

module.exports = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "One honest sentence about this lead for the log.",
    },
    qualityScore: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description:
        "Your own quality score from the lead's content — NOT the platform's score.",
    },
    verdict: {
      type: "string",
      enum: ["pursue", "nurture", "skip"],
    },
    reasons: {
      type: "array",
      items: { type: "string" },
      description: "Short, evidence-based reasons for the verdict.",
    },
    nextStep: {
      type: "string",
      description: "One imperative sentence telling the owner what to do.",
    },
    followUpEmail: {
      type: "object",
      description:
        "Required for pursue/nurture. Leave subject and body empty for skip.",
      properties: {
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["subject", "body"],
    },
  },
  required: ["summary", "qualityScore", "verdict", "reasons", "nextStep"],
};
