// Sender adapters. The runtime doesn't care HOW an approved email is delivered
// — it just calls sender.send(message). Swap adapters per install:
//   - dry-run : logs the message, delivers nothing (default, safe)
//   - resend  : warm/transactional agents (Electric Nerdz already uses Resend)
//   - zoho    : cold outreach from a real Zoho mailbox via SMTP
//
// message shape: { from, to, subject, text, replyTo }
// send() returns: { ok, delivered, id, note? }

function createDryRunSender() {
  const outbox = [];
  return {
    name: "dry-run",
    async send(message) {
      outbox.push({ ...message, at: new Date().toISOString() });
      return {
        ok: true,
        delivered: false,
        id: `dry_${outbox.length}`,
        note: "logged, not transmitted",
      };
    },
    _outbox() {
      return outbox;
    },
  };
}

function createResendSender(opts = {}) {
  const apiKey = opts.apiKey || process.env.RESEND_API_KEY;
  const from = opts.from || process.env.RESEND_FROM;
  const _fetch = opts.fetchImpl || globalThis.fetch;

  return {
    name: "resend",
    async send(message) {
      if (!apiKey) throw new Error("RESEND_API_KEY is not set for the Resend sender.");
      const res = await _fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: message.from || from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
      });
      if (!res.ok) {
        throw new Error(`Resend error ${res.status}: ${await res.text()}`);
      }
      const data = await res.json();
      return { ok: true, delivered: true, id: data.id };
    },
  };
}

// Cold outreach from a Zoho mailbox over SMTP. Uses nodemailer, loaded lazily so
// the rest of agent-core stays dependency-free. Enable with:
//   ZOHO_SMTP_USER=jaron@electricnerdz.biz
//   ZOHO_SMTP_PASS=<app-specific password from Zoho>
// Zoho: smtp.zoho.com, port 465 (SSL). Requires SMTP access + an app password
// if 2FA is on. Keep volume at the beta cap (10–25/day).
function createZohoSmtpSender(opts = {}) {
  const host = opts.host || process.env.ZOHO_SMTP_HOST || "smtp.zoho.com";
  const port = Number(opts.port || process.env.ZOHO_SMTP_PORT || 465);

  return {
    name: "zoho-smtp",
    async send(message) {
      let nodemailer;
      try {
        nodemailer = require("nodemailer");
      } catch {
        throw new Error(
          "The Zoho SMTP sender needs nodemailer. Install it in agent-lab: npm i nodemailer"
        );
      }
      const user = opts.user || process.env.ZOHO_SMTP_USER;
      const pass = opts.pass || process.env.ZOHO_SMTP_PASS;
      if (!user || !pass) {
        throw new Error("ZOHO_SMTP_USER / ZOHO_SMTP_PASS are not set.");
      }
      const transport = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      const info = await transport.sendMail({
        from: message.from || user,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      });
      return { ok: true, delivered: true, id: info.messageId };
    },
  };
}

module.exports = { createDryRunSender, createResendSender, createZohoSmtpSender };
