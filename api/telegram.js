// Telegram bot webhook for the Pipeline Builder. The operator drives everything
// from their phone in PLAIN ENGLISH — Claude routes each message to one action.
// Slash commands (/run, /leads, /pending, /pause, /resume, /status) are optional
// shortcuts. All sending reuses the existing pipeline-approve endpoint, so the
// delivery logic lives in exactly one place.
//
// Security:
//   - Telegram signs each call with the secret set on the webhook; we verify the
//     X-Telegram-Bot-Api-Secret-Token header against TELEGRAM_WEBHOOK_SECRET.
//   - Only TELEGRAM_CHAT_ID (the owner) can run commands or tap buttons.

const { sendMessage, answerCallback, editMessageText, tgEscape } = require("../lib/telegram");
const { sb, getSettings, patchSettings } = require("../lib/pipeline-db");
const { createLLM } = require("../agent-lab/packages/agent-core/llm");

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function baseUrl(req) {
  return (
    process.env.PUBLIC_BASE_URL ||
    `https://${(req.headers && req.headers.host) || "electricnerdz.biz"}`
  );
}

const cronSecret = () => process.env.PIPELINE_CRON_SECRET || process.env.CRON_SECRET || "";

// ---------------------------------------------------------------------------
// Natural-language intent routing
// ---------------------------------------------------------------------------
const INTENT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [
        "run",
        "find_leads",
        "list_leads",
        "signups",
        "check_replies",
        "stop_followup",
        "pending",
        "approve",
        "deny",
        "pause",
        "resume",
        "set_target",
        "status",
        "meeting_followup",
        "lead_truth",
        "help",
        "unknown",
      ],
      description: "The single action the owner's message maps to.",
    },
    notes: {
      type: "string",
      description:
        "For meeting_followup: the raw meeting notes from the message (everything that describes the meeting).",
    },
    niche: {
      type: "string",
      description: "Business type to prospect (e.g. dentists, roofers), if the message mentions one.",
    },
    city: {
      type: "string",
      description: "City / location to prospect, if the message mentions one.",
    },
    scope: {
      type: "string",
      enum: ["latest", "all"],
      description: "For approve/deny only: 'all' if they mean every pending draft, otherwise 'latest'.",
    },
    target: {
      type: "string",
      description: "For stop_followup: the business name or email the owner named to stop following up.",
    },
    reply: {
      type: "string",
      description: "One short, friendly sentence confirming what you're about to do.",
    },
  },
  required: ["action"],
};

const INTENT_SYSTEM = `You route a small-business owner's plain-English text to the Electric Nerdz "Pipeline Builder" — a cold-outreach agent — by picking exactly ONE action:

- run: draft outreach for prospects who are due ("run it", "draft some emails", "go", "make drafts").
- find_leads: search for new businesses. Extract niche (business type) + city ("find 20 dentists in Dallas", "get roofers in Miami").
- list_leads: show the saved contact list and each lead's status ("show my leads", "who's in my list", "show contacts", "my leads", "how many leads do I have").
- signups: how many people downloaded the free agent / requested the repo ("how many signups", "download count", "agent downloads", "who signed up for the agent").
- check_replies: scan the inbox for replies and stop follow-ups for anyone who answered ("check replies", "did anyone reply", "any responses", "who replied").
- stop_followup: manually stop following up ONE named prospect who replied / isn't interested — set target to the business name or email named ("mark Bare Med Spa replied", "stop following up Horizon", "no more emails to face kc", "stop bothering ReVive").
- pending: show drafts waiting for approval ("what's waiting", "show the drafts", "anything pending").
- approve: send draft(s). scope="all" if they say all/everything/them all, else "latest" ("send it", "approve", "yes send them").
- deny: reject/skip draft(s). scope like approve ("skip that", "no don't send", "reject all").
- pause: pause the automatic daily runs ("pause the crons", "stop the daily emails", "hold off").
- resume: turn the daily runs back on ("resume", "turn it back on", "start it again").
- set_target: set the default city/niche the DAILY run uses going forward. Extract niche + city ("target dentists in KC going forward", "focus on roofers in Dallas").
- status: an overview ("status", "how's it going", "what's set up").
- meeting_followup: they paste meeting notes and want a follow-up drafted ("follow up on this meeting: ...", "draft the recap: ...", any message that reads like meeting notes with commitments). Put the full notes text in "notes".
- lead_truth: judge the new inbound leads honestly ("run lead truth", "check my new leads", "are these leads any good", "triage the leads").
- help: they ask what they can do.
- unknown: unrelated.

Always fill "reply" with one short friendly confirmation.`;

// ---------------------------------------------------------------------------
// Actions (each sends its own clean reply)
// ---------------------------------------------------------------------------
async function pendingDrafts() {
  return (
    (await sb(
      "outreach_approvals?status=eq.pending&cleared=eq.true&select=approve_token,prospect_email,subject&order=created_at.desc&limit=50"
    )) || []
  );
}

async function actRun(chatId, req) {
  await sendMessage(chatId, "✍️ <b>Drafting…</b>  Each draft will arrive here with an Approve button.");
  const r = await fetch(`${baseUrl(req)}/api/pipeline-run?secret=${encodeURIComponent(cronSecret())}`);
  const j = await r.json().catch(() => ({}));
  if (!j || !j.drafted) {
    await sendMessage(chatId, "📭 Nothing due right now — no prospects are ready for outreach.");
  }
}

async function actFindLeads(chatId, req, niche, city) {
  if (!niche || !city) {
    await sendMessage(chatId, "Tell me the type of business and the city — e.g. <i>“find dentists in Kansas City”</i>.");
    return;
  }
  await sendMessage(chatId, `🔎 Searching <b>${tgEscape(niche)}</b> in <b>${tgEscape(city)}</b>…`);
  const url =
    `${baseUrl(req)}/api/leads-find?secret=${encodeURIComponent(cronSecret())}` +
    `&niche=${encodeURIComponent(niche)}&city=${encodeURIComponent(city)}`;
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (j && j.ok) {
    await sendMessage(
      chatId,
      `Scanned ${j.scanned || 0}, added <b>${j.inserted || 0}</b> new leads — best-fit first.\n\nReply <i>“draft them”</i> when you're ready. You'll approve every email before it sends.`
    );
  } else {
    await sendMessage(chatId, `⚠️ Couldn't search: ${tgEscape((j && j.error) || "unknown error")}`);
  }
}

async function actPending(chatId) {
  const rows = await pendingDrafts();
  if (!rows.length) {
    await sendMessage(chatId, "📭 No drafts waiting. Say <i>“run it”</i> to make some.");
    return;
  }
  await sendMessage(
    chatId,
    `📬 <b>${rows.length} awaiting approval</b>\n` +
      rows.map((r, i) => `${i + 1}. ${tgEscape(r.subject || "(no subject)")} → ${tgEscape(r.prospect_email)}`).join("\n") +
      `\n\nSay <i>“send them all”</i>, or tap the buttons on each draft above.`
  );
}

async function actApprove(chatId, req, scope) {
  const rows = await pendingDrafts();
  if (!rows.length) {
    await sendMessage(chatId, "Nothing to approve right now.");
    return;
  }
  const targets = scope === "all" ? rows : [rows[0]];
  let sent = 0;
  for (const t of targets) {
    const r = await fetch(`${baseUrl(req)}/api/pipeline-approve?token=${encodeURIComponent(t.approve_token)}`);
    const body = await r.text();
    if (r.ok && /Sent/i.test(body)) sent++;
  }
  await sendMessage(chatId, `✅ <b>Sent ${sent}</b>${targets.length > 1 ? ` of ${targets.length}` : ""}.`);
}

async function actDeny(chatId, scope) {
  const rows = await pendingDrafts();
  if (!rows.length) {
    await sendMessage(chatId, "Nothing pending to skip.");
    return;
  }
  const targets = scope === "all" ? rows : [rows[0]];
  for (const t of targets) {
    await sb(`outreach_approvals?approve_token=eq.${encodeURIComponent(t.approve_token)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "rejected" }),
    });
  }
  await sendMessage(chatId, `✖️ <b>Skipped ${targets.length}</b> draft${targets.length === 1 ? "" : "s"}.`);
}

async function actPause(chatId) {
  await patchSettings({ crons_paused: true });
  await sendMessage(
    chatId,
    "⏸️ <b>Paused.</b>  No morning prompts. Nothing auto-finds or auto-drafts. You can still find + draft manually anytime."
  );
}

async function actResume(chatId) {
  await patchSettings({ crons_paused: false });
  await sendMessage(chatId, "▶️ <b>Resumed.</b>  Your <b>8 AM weekday prompt</b> is back on — I'll ask what to prospect each morning before finding anything.");
}

async function actSetTarget(chatId, niche, city) {
  const patch = {};
  if (niche) patch.default_niche = niche;
  if (city) patch.default_city = city;
  if (!Object.keys(patch).length) {
    await sendMessage(chatId, "Tell me a business type and/or city — e.g. <i>“target roofers in Dallas going forward”</i>.");
    return;
  }
  await patchSettings(patch);
  const s = await getSettings();
  await sendMessage(
    chatId,
    `🎯 <b>Daily target set:</b> ${tgEscape(s.default_niche || "—")} in ${tgEscape(s.default_city || "—")}.`
  );
}

async function actStatus(chatId) {
  const [s, rows] = await Promise.all([getSettings(), pendingDrafts()]);
  await sendMessage(
    chatId,
    `📊 <b>Pipeline status</b>\n` +
      `• Automation: ${s.crons_paused ? "⏸️ paused" : "▶️ morning prompt (8 AM CT, weekdays)"}\n` +
      `• Daily target: ${tgEscape(s.default_niche || "not set")} in ${tgEscape(s.default_city || "not set")}\n` +
      `• Drafts awaiting approval: <b>${rows.length}</b>`
  );
}

async function sendHelp(chatId) {
  await sendMessage(
    chatId,
    `💬 <b>Just talk to me in plain English.</b>  For example:\n\n` +
      `• <i>“find 20 dentists in Kansas City”</i>\n` +
      `• <i>“draft outreach”</i> / <i>“run it”</i>\n` +
      `• <i>“show my leads”</i>\n` +
      `• <i>“how many signups?”</i>\n` +
      `• <i>“check replies”</i> / <i>“stop following up Bare Med Spa”</i>\n` +
      `• <i>“what's waiting?”</i>\n` +
      `• <i>“send them all”</i> / <i>“skip that one”</i>\n` +
      `• <i>“pause the daily emails”</i> / <i>“turn it back on”</i>\n` +
      `• <i>“target roofers in Dallas going forward”</i>\n` +
      `• <i>“status”</i>\n` +
      `• Paste meeting notes: <i>“follow up on this meeting: …”</i> (include their email)\n` +
      `• <i>“check my new leads”</i> — Lead Truth judges them honestly\n\n` +
      `Shortcuts: <code>/run</code> <code>/leads niche | city</code> <code>/list</code> <code>/signups</code> <code>/replies</code> <code>/pending</code> <code>/pause</code> <code>/resume</code> <code>/status</code> <code>/meeting &lt;notes&gt;</code> <code>/leadtruth</code>`
  );
}

function prettyUrl(u) {
  return String(u || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

async function actListLeads(chatId) {
  const rows = await sb(
    "prospects?select=company,email,phone,website,fit_score,email_status,reply_status,opt_out&order=fit_score.desc.nullslast,created_at.desc&limit=25"
  );
  if (!rows || !rows.length) {
    await sendMessage(chatId, "📇 No leads yet. Say <i>“find dentists in Kansas City”</i> to add some.");
    return;
  }
  const tag = (r) => {
    if (r.opt_out === true) return "🚫";
    const rs = String(r.reply_status || "").toLowerCase();
    if (rs === "replied") return "💬";
    if (rs === "unsubscribed" || rs === "no") return "🚫";
    if (rs === "bounced") return "⚠️";
    return String(r.email_status || "").toLowerCase() === "sent" ? "✅" : "🟢";
  };
  const sent = rows.filter((r) => String(r.email_status || "").toLowerCase() === "sent").length;
  const ready = rows.filter(
    (r) => String(r.email_status || "").toLowerCase() === "ready" && r.opt_out !== true
  ).length;
  const lines = rows.map((r) => {
    const details = [`📧 ${tgEscape(r.email)}`];
    if (r.phone) details.push(`📞 ${tgEscape(r.phone)}`);
    if (r.website) details.push(`🌐 ${tgEscape(prettyUrl(r.website))}`);
    const fit = r.fit_score != null ? ` · <b>fit ${r.fit_score}</b>` : "";
    return `${tag(r)} <b>${tgEscape(r.company || "—")}</b>${fit}\n   ${details.join("   ")}`;
  });
  await sendMessage(
    chatId,
    `📇 <b>${rows.length} leads</b>  ·  🟢 ${ready} ready  ·  ✅ ${sent} sent\n\n` +
      lines.join("\n") +
      (rows.length >= 25 ? "\n\n<i>(latest 25 — full list lives in Supabase)</i>" : "")
  );
}

async function actSignups(chatId) {
  const rows = await sb("agent_signups?select=email,created_at&order=created_at.desc&limit=500");
  const n = rows ? rows.length : 0;
  if (!n) {
    await sendMessage(chatId, "📥 No agent downloads yet.");
    return;
  }
  const latest = rows
    .slice(0, 8)
    .map((r) => `• ${tgEscape(r.email)}  <i>${tgEscape(String(r.created_at || "").slice(0, 10))}</i>`);
  await sendMessage(
    chatId,
    `📥 <b>${n}${n >= 500 ? "+" : ""} agent download${n === 1 ? "" : "s"}</b>\n\n<b>Latest:</b>\n` +
      latest.join("\n")
  );
}

async function actStopFollowup(chatId, target) {
  const t = String(target || "").trim();
  if (!t) {
    await sendMessage(chatId, "Who should I stop? e.g. <i>“stop following up Bare Med Spa”</i>");
    return;
  }
  const all = await sb("prospects?select=id,company,email&opt_out=eq.false&limit=500");
  const tl = t.toLowerCase();
  const matches = (all || []).filter(
    (p) =>
      String(p.company || "").toLowerCase().includes(tl) ||
      String(p.email || "").toLowerCase().includes(tl)
  );
  if (!matches.length) {
    await sendMessage(chatId, `No active lead matching “${tgEscape(t)}”.`);
    return;
  }
  for (const p of matches) {
    await sb(`prospects?id=eq.${p.id}`, {
      method: "PATCH",
      body: JSON.stringify({ reply_status: "replied", updated_at: new Date().toISOString() }),
    });
  }
  await sendMessage(
    chatId,
    `✋ <b>Stopped follow-ups</b> for:\n` +
      matches.map((p) => `• <b>${tgEscape(p.company || p.email)}</b>`).join("\n")
  );
}

async function actCheckReplies(chatId, req) {
  await sendMessage(chatId, "📨 Checking your inbox for replies…");
  const r = await fetch(`${baseUrl(req)}/api/check-replies?secret=${encodeURIComponent(cronSecret())}`);
  const j = await r.json().catch(() => ({}));
  if (!j || !j.ok) {
    await sendMessage(chatId, `⚠️ Couldn't check replies: ${tgEscape((j && j.error) || "unknown")}`);
  } else if (!j.flagged) {
    await sendMessage(chatId, `No new replies. (Scanned ${j.checked} recent senders.)`);
  }
  // If replies were found, /api/check-replies already sent the hot-reply alert.
}

// ---- The shared agent layer (meeting-follow-up, lead-truth) ----------------

async function runAgentEndpoint(req, payload) {
  const r = await fetch(`${baseUrl(req)}/api/agent-run?secret=${encodeURIComponent(cronSecret())}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json().catch(() => ({}));
}

async function actMeeting(chatId, req, notes) {
  const text = String(notes || "").trim();
  if (text.length < 20) {
    await sendMessage(
      chatId,
      "📝 Paste the meeting notes after the command — e.g.\n<i>/meeting Kickoff with Dana dana@acme.com — she wants the no-show fix, we send SOW Friday…</i>\n\nInclude the recipient's <b>email address</b> anywhere in the notes so I know where the follow-up goes."
    );
    return;
  }
  // Recipients = any email addresses found in the notes.
  const emails = [...new Set(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [])];
  if (!emails.length) {
    await sendMessage(
      chatId,
      "✋ I don't see an email address in those notes, so I'd have nowhere to send the follow-up. Add the recipient's email anywhere in the text and resend."
    );
    return;
  }
  const title = text.split("\n")[0].slice(0, 60);
  await sendMessage(chatId, `✍️ <b>Drafting the follow-up…</b> (to: ${tgEscape(emails.join(", "))})  It'll arrive here with Approve / Reject links.`);
  const j = await runAgentEndpoint(req, {
    agent: "meeting-follow-up",
    items: [{ id: `mtg_${Date.now()}`, title, attendees: [], attendee_emails: emails, notes: text }],
  });
  if (!j || !j.ok) {
    await sendMessage(chatId, `⚠️ Couldn't run it: ${tgEscape((j && j.error) || "unknown error")}`);
  }
}

async function actLeadTruth(chatId, req) {
  await sendMessage(chatId, "🔍 <b>Judging your new leads…</b>  Real ones arrive here as drafts; junk gets skipped with reasons logged.");
  const j = await runAgentEndpoint(req, { agent: "lead-truth" });
  if (!j || !j.ok) {
    const msg = (j && j.error) || "unknown error";
    if (/no matching rows/i.test(msg)) {
      await sendMessage(chatId, "📭 No new leads to judge — nothing in the table with status <b>new</b>.");
    } else {
      await sendMessage(chatId, `⚠️ Couldn't run it: ${tgEscape(msg)}`);
    }
    return;
  }
  const drafted = j.pendingApprovals || 0;
  const judged = j.items || 0;
  await sendMessage(
    chatId,
    `⚖️ <b>Judged ${judged} lead${judged === 1 ? "" : "s"}.</b>  ${drafted} worth a reply — draft${drafted === 1 ? "" : "s"} incoming with Approve links. ${judged - drafted} skipped (reasons in the log).`
  );
}

async function routeIntent(chatId, req, intent) {
  switch (intent.action) {
    case "run":
      return actRun(chatId, req);
    case "find_leads":
      return actFindLeads(chatId, req, intent.niche, intent.city);
    case "list_leads":
      return actListLeads(chatId);
    case "signups":
      return actSignups(chatId);
    case "check_replies":
      return actCheckReplies(chatId, req);
    case "stop_followup":
      return actStopFollowup(chatId, intent.target);
    case "pending":
      return actPending(chatId);
    case "approve":
      return actApprove(chatId, req, intent.scope || "latest");
    case "deny":
      return actDeny(chatId, intent.scope || "latest");
    case "pause":
      return actPause(chatId);
    case "resume":
      return actResume(chatId);
    case "set_target":
      return actSetTarget(chatId, intent.niche, intent.city);
    case "status":
      return actStatus(chatId);
    case "meeting_followup":
      return actMeeting(chatId, req, intent.notes);
    case "lead_truth":
      return actLeadTruth(chatId, req);
    case "help":
      return sendHelp(chatId);
    default:
      return sendMessage(chatId, "🤔 I didn't quite catch that. Say <i>“help”</i> to see what I can do.");
  }
}

// ---------------------------------------------------------------------------
// Webhook handler
// ---------------------------------------------------------------------------
module.exports = async function handler(req, res) {
  const done = () => {
    res.statusCode = 200;
    res.end("ok");
  };
  if (req.method !== "POST") return done();

  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expected && req.headers["x-telegram-bot-api-secret-token"] !== expected) {
    res.statusCode = 401;
    return res.end("unauthorized");
  }

  const update = await readBody(req);
  const ownerChat = process.env.TELEGRAM_CHAT_ID;
  const notOwner = (chatId) => ownerChat && String(chatId) !== String(ownerChat);

  try {
    // ---- Button taps (Approve / Skip on a specific draft) ----
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message && cq.message.chat && cq.message.chat.id;
      const messageId = cq.message && cq.message.message_id;
      const original = (cq.message && cq.message.text) || "";
      const [action, token] = String(cq.data || "").split(":");

      if (notOwner(chatId)) {
        await answerCallback(cq.id, "Not authorized.");
        return done();
      }
      if (action === "a" && token) {
        const r = await fetch(`${baseUrl(req)}/api/pipeline-approve?token=${encodeURIComponent(token)}`);
        const body = await r.text();
        const sent = r.ok && /Sent/i.test(body);
        await answerCallback(cq.id, sent ? "Sent ✓" : "Could not send");
        await editMessageText(chatId, messageId, tgEscape(original) + `\n\n${sent ? "✅ <b>Sent</b>" : "⚠️ <b>Send failed</b>"}`);
      } else if (action === "s" && token) {
        await sb(`outreach_approvals?approve_token=eq.${encodeURIComponent(token)}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "rejected" }),
        });
        await answerCallback(cq.id, "Skipped");
        await editMessageText(chatId, messageId, tgEscape(original) + "\n\n✖️ <b>Skipped</b>");
      } else {
        await answerCallback(cq.id, "");
      }
      return done();
    }

    // ---- Text ----
    const msg = update.message || update.edited_message;
    if (msg && msg.text) {
      const chatId = msg.chat.id;
      const text = msg.text.trim();

      // /start and /id work for anyone (so the operator can learn the chat ID).
      if (/^\/(start|id)\b/i.test(text)) {
        await sendMessage(
          chatId,
          `👋 <b>Electric Nerdz Pipeline bot</b>\n\nThis chat's ID: <code>${chatId}</code>\n` +
            (ownerChat ? "" : "\n(Set TELEGRAM_CHAT_ID to this to lock the bot to you.)\n")
        );
        await sendHelp(chatId);
        return done();
      }

      if (notOwner(chatId)) {
        await sendMessage(chatId, "Not authorized.");
        return done();
      }

      // Slash shortcuts — fast path, no LLM call.
      if (text.startsWith("/")) {
        if (/^\/run\b/i.test(text)) await actRun(chatId, req);
        else if (/^\/leads\b/i.test(text)) {
          const [niche, city] = text.replace(/^\/leads\b/i, "").split("|").map((s) => s.trim());
          await actFindLeads(chatId, req, niche, city);
        } else if (/^\/pending\b/i.test(text)) await actPending(chatId);
        else if (/^\/(list|contacts)\b/i.test(text)) await actListLeads(chatId);
        else if (/^\/(signups|downloads)\b/i.test(text)) await actSignups(chatId);
        else if (/^\/(replies|checkreplies)\b/i.test(text)) await actCheckReplies(chatId, req);
        else if (/^\/pause\b/i.test(text)) await actPause(chatId);
        else if (/^\/resume\b/i.test(text)) await actResume(chatId);
        else if (/^\/status\b/i.test(text)) await actStatus(chatId);
        else if (/^\/meeting\b/i.test(text)) await actMeeting(chatId, req, text.replace(/^\/meeting\b/i, "").trim());
        else if (/^\/(leadtruth|truth)\b/i.test(text)) await actLeadTruth(chatId, req);
        else await sendHelp(chatId);
        return done();
      }

      // Plain English — Claude routes it (fast, cheap model).
      let intent = { action: "unknown" };
      try {
        const llm = createLLM({ model: "claude-haiku-4-5" });
        intent = await llm.decide({ system: INTENT_SYSTEM, prompt: text, schema: INTENT_SCHEMA, maxTokens: 300 });
      } catch (e) {
        console.log("[telegram] intent parse failed:", e && e.message);
        await sendHelp(chatId);
        return done();
      }
      await routeIntent(chatId, req, intent);
      return done();
    }

    return done();
  } catch (err) {
    console.log("[telegram] error:", err && err.message);
    return done();
  }
};
