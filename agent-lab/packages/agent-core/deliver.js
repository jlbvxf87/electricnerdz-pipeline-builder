// The send step — runs AFTER a human approves a pending action.
// This is the only place an email actually leaves. It refuses to send anything
// that isn't compliance-cleared, so the CAN-SPAM guardrails can't be bypassed
// by approving.

async function approveAndSend({ store, approvalId, sender }) {
  const approval =
    typeof store.getApproval === "function"
      ? await store.getApproval(approvalId)
      : (await store.listApprovals({})).find((a) => a.id === approvalId);
  if (!approval) throw new Error(`approval ${approvalId} not found`);

  // Idempotency: never send twice.
  if (approval.status === "sent") {
    return { ok: true, alreadySent: true };
  }
  // A rejected approval can never be sent afterward.
  if (approval.status === "rejected") {
    return { ok: false, reason: "rejected" };
  }

  const action = approval.action || {};

  // Hard gate: compliance must have cleared this action.
  if (action.cleared !== true) {
    await store.setApprovalStatus(approvalId, "blocked");
    return {
      ok: false,
      reason: "not_compliant",
      violations: (action.compliance && action.compliance.violations) || [],
    };
  }

  // Hard gate: a send action must have at least one recipient address.
  const recipients = Array.isArray(action.to) ? action.to : [action.to].filter(Boolean);
  if (recipients.length === 0) {
    await store.setApprovalStatus(approvalId, "blocked");
    return { ok: false, reason: "no_recipient", violations: [] };
  }

  const message = {
    from: action.from,
    to: action.to,
    subject: action.draft && action.draft.subject,
    text: action.draft && action.draft.body,
    replyTo: action.from,
  };

  const result = await sender.send(message);

  await store.setApprovalStatus(
    approvalId,
    result.delivered ? "sent" : "approved_dryrun"
  );
  await store.appendLog({
    step: "send",
    approvalId,
    to: action.to,
    sender: sender.name,
    delivered: Boolean(result.delivered),
    messageId: result.id || null,
  });

  return { ok: true, result };
}

module.exports = { approveAndSend };
