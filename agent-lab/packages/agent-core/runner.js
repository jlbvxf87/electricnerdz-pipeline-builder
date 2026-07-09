// The runtime that every agent shares: Read -> Decide -> Draft/Act -> Ask Approval -> Log.
//
// An "agent" is a plain object:
//   {
//     manifest,                       // metadata (mirrors the site card)
//     read(ctx)      -> [items],      // pull the work
//     decide(item, ctx) -> decision,  // LLM structured output
//     act(item, decision, ctx) -> action,  // build the proposed action
//     needsApproval(action, decision, item) -> boolean  // the stop sign
//   }
//
// ctx: { store, llm, items?, connectors? }

async function runAgent(agent, ctx) {
  if (!agent || typeof agent.read !== "function") {
    throw new Error("Invalid agent: missing read()");
  }
  const store = ctx.store;
  const name = agent.manifest?.name || "unknown-agent";
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const startedAt = new Date().toISOString();

  await store.appendLog({ runId, agent: name, step: "read" });
  const items = (await agent.read(ctx)) || [];

  const results = [];

  for (const item of items) {
    const itemId = item.id || item.title || `item_${results.length + 1}`;

    // Decide
    await store.appendLog({ runId, agent: name, step: "decide", itemId });
    const decision = await agent.decide(item, ctx);

    // Draft / Act
    await store.appendLog({ runId, agent: name, step: "act", itemId });
    const action = await agent.act(item, decision, ctx);

    // Ask Approval (stop sign)
    const gated =
      typeof agent.needsApproval === "function"
        ? Boolean(agent.needsApproval(action, decision, item))
        : false;

    let approval = null;
    if (gated) {
      approval = await store.createApproval({
        runId,
        agent: name,
        itemId,
        action,
      });
      await store.appendLog({
        runId,
        agent: name,
        step: "await_approval",
        itemId,
        approvalId: approval.id,
      });
    }

    // Log
    await store.appendLog({
      runId,
      agent: name,
      step: "log",
      itemId,
      decisionSummary: decision.summary || null,
      actionKind: action.kind || null,
      gated,
    });

    results.push({ itemId, item, decision, action, approval });
  }

  const run = {
    runId,
    agent: name,
    startedAt,
    finishedAt: new Date().toISOString(),
    count: results.length,
    results,
  };

  await store.saveRun(run);
  return run;
}

module.exports = { runAgent };
