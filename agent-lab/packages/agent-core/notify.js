// Owner notifications for pending approvals — email (Resend) + Telegram.
// Any agent's gated action lands on your phone with one-click
// "Approve & send" / "Reject" links. Both channels are optional: whichever
// env vars are present get used, and failures in one never block the other.
//
// notifyApproval({ approval, baseUrl, ...opts }) -> { email, telegram }

function esc(s) {
  return String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function links(approval, baseUrl) {
  return {
    approve: `${baseUrl}/api/agent-approve?token=${approval.approveToken}`,
    reject: `${baseUrl}/api/agent-reject?token=${approval.rejectToken}`,
  };
}

function emailHtml(approval, baseUrl) {
  const action = approval.action || {};
  const draft = action.draft || {};
  const { approve, reject } = links(approval, baseUrl);
  const to = Array.isArray(action.to) ? action.to.join(", ") : action.to || "";

  const bodyHtml = esc(draft.body || "")
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p style="margin:0 0 14px;line-height:1.6">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");

  const cta = action.cleared
    ? `<a href="${approve}" style="display:inline-block;padding:13px 28px;background:#172ED7;color:#ffffff;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Approve &amp; send →</a>` +
      `<a href="${reject}" style="display:inline-block;margin-left:12px;padding:13px 22px;background:#f2f3f5;color:#10151B;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px">Reject</a>`
    : `<div style="padding:12px 16px;background:#fff4f4;border:1px solid #f0c4c4;border-radius:10px;color:#b00020;font-weight:600">Blocked: not cleared to send${
        action.compliance && action.compliance.violations && action.compliance.violations.length
          ? " — " + esc(action.compliance.violations.join(", "))
          : ""
      }</div>`;

  return (
    `<div style="background:#eef0f3;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">` +
      `<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e5e8ec;overflow:hidden">` +
        `<div style="padding:22px 28px 18px;border-bottom:1px solid #eef0f3">` +
          `<div style="font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#9099a3;font-weight:700">${esc(approval.agent)} &middot; pending approval</div>` +
          `<div style="font-size:21px;font-weight:800;color:#10151B;margin-top:5px">${esc(approval.itemId || draft.subject || "Proposed action")}</div>` +
        `</div>` +
        `<div style="padding:22px 28px">` +
          `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px">` +
            `<tr><td style="padding:3px 0;width:64px;color:#9099a3">To</td><td style="padding:3px 0;font-weight:600;color:#10151B">${esc(to)}</td></tr>` +
            `<tr><td style="padding:3px 0;color:#9099a3">Subject</td><td style="padding:3px 0;color:#10151B">${esc(draft.subject || "")}</td></tr>` +
          `</table>` +
          `<div style="margin:18px 0;padding:18px 20px;background:#f8f9fb;border-radius:12px;font-size:14px;color:#28303a">${bodyHtml}</div>` +
          cta +
        `</div>` +
      `</div>` +
    `</div>`
  );
}

function telegramText(approval, baseUrl) {
  const action = approval.action || {};
  const draft = action.draft || {};
  const { approve, reject } = links(approval, baseUrl);
  const to = Array.isArray(action.to) ? action.to.join(", ") : action.to || "";
  const lines = [
    `<b>${esc(approval.agent)}</b> — pending approval`,
    `<b>To:</b> ${esc(to)}`,
    `<b>Subject:</b> ${esc(draft.subject || "")}`,
    "",
    esc(String(draft.body || "").slice(0, 800)),
  ];
  if (action.cleared) {
    lines.push("", `✅ <a href="${approve}">Approve &amp; send</a>  ·  ❌ <a href="${reject}">Reject</a>`);
  } else {
    lines.push("", "⛔ Blocked: not cleared to send.");
  }
  return lines.join("\n");
}

// Sends on every configured channel. Never throws for a single channel failing.
async function notifyApproval({
  approval,
  baseUrl,
  ownerEmail = process.env.OUTREACH_OWNER || process.env.LEAD_NOTIFY_TO,
  resendApiKey = process.env.RESEND_API_KEY,
  resendFrom = process.env.RESEND_FROM || "Electric Nerdz <hello@electricnerdz.biz>",
  telegramToken = process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId = process.env.TELEGRAM_CHAT_ID,
  fetchImpl,
} = {}) {
  const _fetch = fetchImpl || globalThis.fetch;
  const result = { email: null, telegram: null };
  const draft = (approval.action && approval.action.draft) || {};

  if (resendApiKey && ownerEmail) {
    try {
      const res = await _fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: resendFrom,
          to: ownerEmail,
          subject: `[${approval.agent}] Approve: ${draft.subject || approval.itemId || "pending action"}`,
          html: emailHtml(approval, baseUrl),
        }),
      });
      result.email = { ok: res.ok };
    } catch (err) {
      result.email = { ok: false, error: err.message };
    }
  }

  if (telegramToken && telegramChatId) {
    try {
      const res = await _fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text: telegramText(approval, baseUrl),
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });
      result.telegram = { ok: res.ok };
    } catch (err) {
      result.telegram = { ok: false, error: err.message };
    }
  }

  return result;
}

module.exports = { notifyApproval, emailHtml, telegramText };
