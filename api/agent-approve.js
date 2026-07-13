// Generic "Approve & send" link target for ANY agent on the shared layer.
// The unguessable single-use token is the auth. Delivery goes through
// agent-core's approveAndSend, so the compliance gate and idempotency
// can't be bypassed by clicking twice.

const {
  createSupabaseStore,
  createResendSender,
  approveAndSend,
} = require("../agent-lab/packages/agent-core");
const { html } = require("../lib/pipeline-db");

module.exports = async function handler(req, res) {
  let token;
  try {
    token = new URL(req.url, "http://localhost").searchParams.get("token");
  } catch {}
  if (!token) return html(res, 400, "<h2>Missing token</h2>");

  try {
    const store = createSupabaseStore();
    const approval = await store.findApprovalByToken(token, "approve");
    if (!approval) {
      return html(res, 404, "<h2>Not found</h2><p>This approval link is invalid.</p>");
    }
    if (approval.status !== "pending") {
      return html(res, 200, `<h2>Already ${approval.status}</h2><p>No further action taken.</p>`);
    }

    // Warm/transactional agents deliver via Resend.
    const sender = createResendSender();
    const result = await approveAndSend({ store, approvalId: approval.id, sender });

    if (!result.ok) {
      const why =
        result.reason === "not_compliant"
          ? `Blocked by compliance${result.violations && result.violations.length ? ": " + result.violations.join(", ") : ""}.`
          : result.reason === "no_recipient"
            ? "Blocked: the action has no recipient email address."
            : `Blocked: ${result.reason}.`;
      return html(res, 200, `<h2>Not sent</h2><p>${why}</p>`);
    }

    await store.setApprovalStatus(approval.id, "sent", {
      sent_at: new Date().toISOString(),
      message_id: (result.result && result.result.id) || null,
    });

    const to = Array.isArray(approval.action.to)
      ? approval.action.to.join(", ")
      : approval.action.to;
    return html(
      res,
      200,
      `<h2>Sent ✓</h2><p><b>${approval.agent}</b> email delivered to ${to}.</p>`
    );
  } catch (err) {
    return html(res, 500, `<h2>Error</h2><p>${String(err.message || err)}</p>`);
  }
};
