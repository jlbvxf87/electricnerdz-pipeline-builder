// Weekday morning prompt (8:00 AM CT / 13:00 UTC). Instead of auto-scraping,
// the agent ASKS the owner what to prospect today. Nothing is searched or
// drafted until they reply in Telegram with a sector + city/zip.
//
//   GET /api/morning-prompt            (Vercel cron — scheduled)
//   GET /api/morning-prompt?secret=... (manual trigger / demo)

const { json, authorized, getSettings } = require("../lib/pipeline-db");

module.exports = async function handler(req, res) {
  if (!authorized(req)) return json(res, 401, { ok: false, error: "Unauthorized" });

  let params;
  try {
    params = new URL(req.url, "http://localhost").searchParams;
  } catch {
    params = new URLSearchParams();
  }

  // A scheduled (Vercel cron) call has no ?secret. Pausing suppresses the
  // scheduled morning prompt; a manual ?secret call always sends (for demos).
  const scheduled = !params.get("secret");
  const settings = await getSettings();
  if (scheduled && settings.crons_paused) {
    return json(res, 200, { ok: true, skipped: "crons_paused" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return json(res, 200, { ok: false, error: "Telegram not configured" });
  }

  const { sendMessage } = require("../lib/telegram");
  await sendMessage(
    chatId,
    `☀️ <b>Good morning!</b>  Who should I prospect today?\n\n` +
      `Reply with a <b>sector + city or zip</b>, like:\n` +
      `<code>find dentists in 64111</code>\n` +
      `<code>find roofers in Dallas</code>\n\n` +
      `I'll pull 20–25 of the best-fit leads (ranked by reviews + visible opportunity), then <b>wait for your go</b> before drafting anything — and you approve every email before it sends.\n\n` +
      `<i>Not today? Just ignore this and nothing happens.</i>`,
  );

  return json(res, 200, { ok: true, prompted: true });
};
