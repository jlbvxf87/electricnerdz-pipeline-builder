// Anthropic-backed Decide/Draft step.
// Uses tool-use to force a structured, schema-valid result — no fragile JSON parsing.
//
// createLLM() reads ANTHROPIC_API_KEY from the environment. If the key is
// missing, decide() throws a clear error. Tests inject a mock llm instead,
// so the whole loop runs offline against fake data with no key required.

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function createLLM(options = {}) {
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  const model = options.model || DEFAULT_MODEL;

  return {
    provider: "anthropic",
    model,

    // decide({ system, prompt, schema }) -> structured object matching schema
    async decide({ system, prompt, schema, maxTokens = 2048 }) {
      if (!apiKey) {
        throw new Error(
          "ANTHROPIC_API_KEY is not set. Set it to run agents live, " +
            "or inject a mock llm (see agents/*/agent.test.js) to run offline."
        );
      }

      const body = {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: prompt }],
        tools: [
          {
            name: "emit_result",
            description: "Return the structured result for this task.",
            input_schema: schema,
          },
        ],
        tool_choice: { type: "tool", name: "emit_result" },
      };

      const res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const details = await res.text();
        throw new Error(`Anthropic error ${res.status}: ${details}`);
      }

      const data = await res.json();
      const toolUse = (data.content || []).find((c) => c.type === "tool_use");
      if (!toolUse) {
        throw new Error("Model did not return a structured result.");
      }
      return toolUse.input;
    },
  };
}

module.exports = { createLLM, DEFAULT_MODEL };
