// Structured-output schema for the Decide step.
// Passed to the LLM as a tool input_schema so the result is always valid shape.

module.exports = {
  type: "object",
  properties: {
    summary: { type: "string" },
    followUpEmail: {
      type: "object",
      properties: {
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["subject", "body"],
    },
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          owner: { type: "string" },
          title: { type: "string" },
          due: { type: "string", description: "ISO date YYYY-MM-DD, optional" },
        },
        required: ["title"],
      },
    },
    openQuestions: { type: "array", items: { type: "string" } },
    decisions: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "followUpEmail", "tasks"],
};
