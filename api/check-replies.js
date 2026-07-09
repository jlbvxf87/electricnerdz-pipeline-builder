// GET /api/check-replies?secret=...  (or Vercel cron)
//
// Reply detection. Connects to the outreach mailbox over IMAP, scans recent
// inbound mail, and for any sender that matches a prospect we've emailed:
//   - marks reply_status = 'replied'  → eligibility stops all follow-ups
//   - pings the owner on Telegram so hot replies get a fast human touch
//
// Idempotent: a prospect already in a stop state is skipped, so re-scans don't
// double-notify. Only envelope (From) is read — not message bodies.
//
// Env: ZOHO_SMTP_USER / ZOHO_SMTP_PASS (same mailbox that sends), optional
//      ZOHO_IMAP_HOST (default imap.zoho.com) / ZOHO_IMAP_PORT (default 993).

const { json, sb, authorized } = require("../lib/pipeline-db");

const STOP = new Set(["replied", "no", "not_interested", "unsubscribed", "bounced"]);
const LOOKBACK_DAYS = 5;
const MAX_MESSAGES = 400; // cap work on a busy inbox

module.exports = async function handler(req, res) {
  if (!authorized(req)) return json(res, 401, { ok: false, error: "Unauthorized" });

  let ImapFlow;
  try {
    ({ ImapFlow } = require("imapflow"));
  } catch {
    return json(res, 500, { ok: false, error: "imapflow not installed" });
  }
  const user = process.env.ZOHO_SMTP_USER;
  const pass = process.env.ZOHO_SMTP_PASS;
  if (!user || !pass) {
    return json(res, 500, { ok: false, error: "ZOHO_SMTP_USER / ZOHO_SMTP_PASS not set" });
  }

  const client = new ImapFlow({
    host: process.env.ZOHO_IMAP_HOST || "imap.zoho.com",
    port: Number(process.env.ZOHO_IMAP_PORT || 993),
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  // 1. Pull the From address of recent inbound mail.
  const froms = new Set();
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000);
      let list = await client.search({ since }, { uid: true });
      if (!Array.isArray(list)) list = [];
      const uids = list.slice(-MAX_MESSAGES);
      if (uids.length) {
        for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
          const addr =
            msg.envelope && msg.envelope.from && msg.envelope.from[0] && msg.envelope.from[0].address;
          if (addr) froms.add(String(addr).toLowerCase());
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    try {
      await client.close();
    } catch {}
    const detail = (err && (err.responseText || err.serverResponseCode)) || "";
    return json(res, 502, {
      ok: false,
      error: "IMAP error: " + (err && err.message) + (detail ? ` — ${detail}` : ""),
      authFailed: !!(err && err.authenticationFailed),
    });
  }

  if (!froms.size) return json(res, 200, { ok: true, checked: 0, flagged: 0 });

  // 2. Match against active prospects (not opted out, not already stopped).
  const prospects = await sb("prospects?select=id,email,company,reply_status&opt_out=eq.false&limit=1000");
  const flagged = [];
  for (const p of prospects || []) {
    if (STOP.has(String(p.reply_status || "").toLowerCase())) continue;
    if (froms.has(String(p.email || "").toLowerCase())) {
      try {
        await sb(`prospects?id=eq.${p.id}`, {
          method: "PATCH",
          body: JSON.stringify({ reply_status: "replied", updated_at: new Date().toISOString() }),
        });
        flagged.push(p);
      } catch (e) {
        /* best-effort */
      }
    }
  }

  // 3. Alert the owner about hot replies.
  if (flagged.length && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      const { sendMessage, tgEscape } = require("../lib/telegram");
      await sendMessage(
        process.env.TELEGRAM_CHAT_ID,
        `🔥 <b>${flagged.length} repl${flagged.length === 1 ? "y" : "ies"}!</b>  Follow-ups auto-stopped for:\n` +
          flagged.map((p) => `• <b>${tgEscape(p.company || p.email)}</b> — ${tgEscape(p.email)}`).join("\n")
      );
    } catch (e) {
      /* best-effort */
    }
  }

  return json(res, 200, { ok: true, checked: froms.size, flagged: flagged.length });
};
