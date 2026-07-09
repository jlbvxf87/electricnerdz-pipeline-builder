// Shared helpers for the Pipeline Builder endpoints: Supabase access, owner
// notifications, and request auth. Server-side only (service role key).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || "Electric Nerdz <hello@electricnerdz.biz>";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function html(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<body style="font-family:system-ui;max-width:560px;margin:60px auto;padding:0 20px;color:#101522">${body}</body>`
  );
}

async function sb(path, opts = {}) {
  if (!SUPABASE_URL || !SRK) throw new Error("Supabase env vars missing.");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SRK,
      Authorization: `Bearer ${SRK}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function sendOwnerEmail(to, subject, htmlBody) {
  if (!RESEND_API_KEY || !to) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, html: htmlBody }),
  });
}

// Single-row settings (id=1): crons_paused, default_city, default_niche.
async function getSettings() {
  try {
    const rows = await sb("pipeline_settings?id=eq.1&select=*");
    return (rows && rows[0]) || {};
  } catch {
    return {};
  }
}

async function patchSettings(patch) {
  return sb("pipeline_settings?id=eq.1", {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

function baseUrl(req) {
  return (
    process.env.PUBLIC_BASE_URL ||
    `https://${(req.headers && req.headers.host) || "electricnerdz.biz"}`
  );
}

// Accept either a Vercel Cron bearer (CRON_SECRET) or a manual ?secret=.
function authorized(req) {
  const expected = process.env.PIPELINE_CRON_SECRET || process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = (req.headers && req.headers.authorization) || "";
  let secret = null;
  try {
    secret = new URL(req.url, "http://localhost").searchParams.get("secret");
  } catch {}
  return auth === `Bearer ${expected}` || secret === expected;
}

module.exports = { json, html, sb, sendOwnerEmail, baseUrl, authorized, getSettings, patchSettings };
