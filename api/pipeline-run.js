// Daily draft job: read eligible prospects -> Claude drafts -> store pending
// approvals -> email the owner one-click "Approve & send" links.
// Protected (cron bearer or ?secret=). Nothing is sent here.

const crypto = require("node:crypto");
const { draftOutreach } = require("../lib/pipeline");
const { json, sb, sendOwnerEmail, baseUrl, authorized, getSettings } = require("../lib/pipeline-db");

function esc(s) {
  return String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

module.exports = async function handler(req, res) {
  if (!authorized(req)) return json(res, 401, { ok: false, error: "Unauthorized" });
  if (!process.env.ANTHROPIC_API_KEY) {
    return json(res, 500, { ok: false, error: "ANTHROPIC_API_KEY is not set." });
  }

  // Scheduled (Vercel cron) calls have no ?secret; pausing suppresses only those.
  const scheduled = !new URL(req.url, "http://localhost").searchParams.get("secret");
  const settings = await getSettings();
  if (scheduled && settings.crons_paused) {
    return json(res, 200, { ok: true, skipped: "crons_paused", drafted: 0 });
  }

  try {
    // All prospects the eligibility filter might use (it decides who's due).
    const prospects = await sb("prospects?select=*&opt_out=eq.false&limit=500");
    const drafts = await draftOutreach(prospects);

    const owner = process.env.OUTREACH_OWNER || process.env.LEAD_NOTIFY_TO;
    const results = [];

    for (const d of drafts) {
      const token = crypto.randomBytes(24).toString("base64url");
      const inserted = await sb("outreach_approvals", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          prospect_email: d.action.to,
          touch: d.action.touch,
          subject: d.action.subject,
          body: d.action.body,
          from_email: d.action.from,
          offer_angle: d.action.offerAngle,
          cleared: d.action.cleared,
          compliance: d.action.compliance,
          follow_up_date: d.action.followUpDate,
          status: "pending",
          approve_token: token,
          action: d.action,
        }),
      });
      const approval = inserted[0];
      const link = `${baseUrl(req)}/api/pipeline-approve?token=${token}`;

      if (owner) {
        const bodyHtml = esc(d.action.body)
          .split(/\n{2,}/)
          .filter((p) => p.trim())
          .map((p) => `<p style="margin:0 0 14px;line-height:1.6">${p.replace(/\n/g, "<br>")}</p>`)
          .join("");

        const cta = d.action.cleared
          ? `<a href="${link}" style="display:inline-block;padding:13px 28px;background:#172ED7;color:#ffffff;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Approve &amp; send →</a>`
          : `<div style="padding:12px 16px;background:#fff4f4;border:1px solid #f0c4c4;border-radius:10px;color:#b00020;font-weight:600">Blocked by compliance: ${esc((d.action.compliance.violations || []).join(", "))}</div>`;

        await sendOwnerEmail(
          owner,
          `Pipeline draft: ${d.prospect.company || d.action.to} (${d.action.touch})`,
          `<div style="background:#eef0f3;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">` +
            `<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e5e8ec;overflow:hidden">` +
              `<div style="padding:22px 28px 18px;border-bottom:1px solid #eef0f3">` +
                `<div style="font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#9099a3;font-weight:700">Pipeline draft &middot; ${esc(d.action.touch)}</div>` +
                `<div style="font-size:21px;font-weight:800;color:#10151B;margin-top:5px">${esc(d.prospect.company || d.action.to)}</div>` +
              `</div>` +
              `<div style="padding:22px 28px">` +
                `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px">` +
                  `<tr><td style="padding:3px 0;width:64px;color:#9099a3">To</td><td style="padding:3px 0;font-weight:600;color:#10151B">${esc(d.action.to)}</td></tr>` +
                  `<tr><td style="padding:3px 0;color:#9099a3">Angle</td><td style="padding:3px 0;color:#10151B">${esc(d.action.offerAngle)}</td></tr>` +
                  `<tr><td style="padding:3px 0;color:#9099a3">Fit</td><td style="padding:3px 0;color:#10151B">${esc(String(d.action.fitScore))} / 100</td></tr>` +
                `</table>` +
                `<div style="margin:22px 0 5px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:#9099a3;font-weight:700">Subject</div>` +
                `<div style="font-size:16px;font-weight:700;color:#10151B">${esc(d.action.subject || "(none)")}</div>` +
                `<div style="margin-top:16px;background:#f7f8fa;border:1px solid #eef0f3;border-radius:12px;padding:18px 20px;font-size:15px;color:#242b34">${bodyHtml}</div>` +
                `<div style="margin-top:24px">${cta}</div>` +
              `</div>` +
            `</div>` +
          `</div>`
        );
      }

      // Push the draft to Telegram too (if configured), with tap-to-approve.
      if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        try {
          const { sendMessage, tgEscape } = require("../lib/telegram");
          const header =
            `<b>${tgEscape(d.prospect.company || d.action.to)}</b> · fit ${tgEscape(String(d.action.fitScore))}/100\n` +
            `To: ${tgEscape(d.action.to)}\nAngle: ${tgEscape(d.action.offerAngle)}\n\n` +
            `<b>${tgEscape(d.action.subject || "(no subject)")}</b>\n\n${tgEscape(d.action.body)}`;
          const extra = d.action.cleared
            ? {
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: "✅ Approve & send", callback_data: `a:${token}` },
                      { text: "✖️ Skip", callback_data: `s:${token}` },
                    ],
                  ],
                },
              }
            : {};
          const prefix = d.action.cleared
            ? ""
            : "⚠️ <i>Blocked by compliance — not sendable.</i>\n\n";
          await sendMessage(process.env.TELEGRAM_CHAT_ID, prefix + header, extra);
        } catch (e) {
          // Telegram push is best-effort; never fail the draft run over it.
        }
      }

      results.push({
        prospect: d.prospect.company || d.action.to,
        touch: d.action.touch,
        cleared: d.action.cleared,
        approval_id: approval.id,
      });
    }

    return json(res, 200, { ok: true, drafted: results.length, results });
  } catch (err) {
    return json(res, 500, { ok: false, error: err.message });
  }
};
