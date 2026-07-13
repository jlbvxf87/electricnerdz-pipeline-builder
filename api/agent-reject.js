// Generic "Reject" link target. Marks the pending approval rejected so it can
// never be sent — approveAndSend refuses rejected approvals permanently.

const { createSupabaseStore } = require("../agent-lab/packages/agent-core");
const { html } = require("../lib/pipeline-db");

module.exports = async function handler(req, res) {
  let token;
  try {
    token = new URL(req.url, "http://localhost").searchParams.get("token");
  } catch {}
  if (!token) return html(res, 400, "<h2>Missing token</h2>");

  try {
    const store = createSupabaseStore();
    const approval = await store.findApprovalByToken(token, "reject");
    if (!approval) {
      return html(res, 404, "<h2>Not found</h2><p>This link is invalid.</p>");
    }
    if (approval.status !== "pending") {
      return html(res, 200, `<h2>Already ${approval.status}</h2><p>No further action taken.</p>`);
    }

    await store.setApprovalStatus(approval.id, "rejected");
    await store.appendLog({
      step: "reject",
      agent: approval.agent,
      runId: approval.runId,
      approvalId: approval.id,
    });

    return html(
      res,
      200,
      `<h2>Rejected ✓</h2><p>The <b>${approval.agent}</b> draft was discarded. Nothing was sent.</p>`
    );
  } catch (err) {
    return html(res, 500, `<h2>Error</h2><p>${String(err.message || err)}</p>`);
  }
};
