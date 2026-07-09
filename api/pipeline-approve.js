// The "Approve & send" link target. Loads the pending draft by its token,
// re-checks compliance, sends via Zoho SMTP, and updates the prospect.
// The token itself is the auth (unguessable, single-use).

const { createZohoSmtpSender } = require("../agent-lab/packages/agent-core/senders");
const { html, sb } = require("../lib/pipeline-db");

module.exports = async function handler(req, res) {
  let token;
  try {
    token = new URL(req.url, "http://localhost").searchParams.get("token");
  } catch {}
  if (!token) return html(res, 400, "<h2>Missing token</h2>");

  try {
    const rows = await sb(
      `outreach_approvals?approve_token=eq.${encodeURIComponent(token)}&select=*`
    );
    const appr = rows && rows[0];
    if (!appr) return html(res, 404, "<h2>Not found</h2><p>This approval link is invalid.</p>");
    if (appr.status !== "pending") {
      return html(res, 200, `<h2>Already ${appr.status}</h2><p>No further action taken.</p>`);
    }
    if (!appr.cleared) {
      await sb(`outreach_approvals?id=eq.${appr.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "blocked" }),
      });
      const v = (appr.compliance && appr.compliance.violations) || [];
      return html(res, 200, `<h2>Blocked by compliance</h2><p>${v.join(", ")}</p>`);
    }

    // Send via Zoho.
    const sender = createZohoSmtpSender();
    const result = await sender.send({
      from: appr.from_email,
      to: appr.prospect_email,
      subject: appr.subject,
      text: appr.body,
      replyTo: appr.from_email,
    });

    await sb(`outreach_approvals?id=eq.${appr.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "sent",
        sent_at: new Date().toISOString(),
        message_id: result.id || null,
      }),
    });

    // Advance the prospect: bump sent_count, mark Sent, schedule the follow-up.
    const ps = await sb(
      `prospects?email=eq.${encodeURIComponent(appr.prospect_email)}&select=id,sent_count`
    );
    if (ps && ps[0]) {
      await sb(`prospects?id=eq.${ps[0].id}`, {
        method: "PATCH",
        body: JSON.stringify({
          sent_count: Number(ps[0].sent_count || 0) + 1,
          email_status: "Sent",
          follow_up_date: appr.follow_up_date,
          updated_at: new Date().toISOString(),
        }),
      });
    }

    return html(
      res,
      200,
      `<h2>Sent &#10003;</h2><p>Emailed <b>${appr.prospect_email}</b> from ${appr.from_email}.</p>` +
        (appr.follow_up_date ? `<p>Follow-up scheduled for ${appr.follow_up_date}.</p>` : "")
    );
  } catch (err) {
    return html(res, 502, `<h2>Send failed</h2><pre>${err.message}</pre>`);
  }
};
