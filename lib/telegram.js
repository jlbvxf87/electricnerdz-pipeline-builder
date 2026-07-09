// Minimal Telegram Bot API helpers. Reads TELEGRAM_BOT_TOKEN from the env.
// Server-side only — the token never reaches the client.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function tg(method, body) {
  if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not set.");
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function sendMessage(chatId, text, extra = {}) {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

function answerCallback(callbackQueryId, text = "") {
  return tg("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

function editMessageText(chatId, messageId, text, extra = {}) {
  return tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

// Escape the three characters that matter for Telegram's HTML parse mode.
function tgEscape(s) {
  return String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

module.exports = { tg, sendMessage, answerCallback, editMessageText, tgEscape };
