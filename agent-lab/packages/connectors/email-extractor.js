// Reads a business's OWN public website to find the email they've published for
// contact. Same as a person opening their Contact page and copying the address.
// No third-party platforms, no scraping of anyone else's data.

const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;

// Junk that shows up in HTML but isn't a real contact address.
const SKIP_RE =
  /(sentry|wixpress|example\.(com|org)|yourdomain|domain\.com|email\.com|\.(png|jpe?g|gif|webp|svg))/i;

// Role addresses we prefer for cold outreach (a general business inbox).
const PREFERRED = ["info@", "contact@", "hello@", "office@", "sales@", "admin@", "team@"];

function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function join(base, path) {
  try {
    return new URL(path, base).href;
  } catch {
    return null;
  }
}

function pickBest(emails, websiteUrl) {
  if (!emails.length) return null;
  const domain = hostname(websiteUrl);
  const unique = [...new Set(emails.map((e) => e.toLowerCase()))];

  // Prefer emails on the business's own domain.
  const onDomain = domain ? unique.filter((e) => e.endsWith("@" + domain)) : [];
  const pool = onDomain.length ? onDomain : unique;

  // Prefer a role inbox.
  for (const role of PREFERRED) {
    const hit = pool.find((e) => e.startsWith(role));
    if (hit) return hit;
  }
  return pool[0];
}

async function extractEmailFromSite(websiteUrl, { fetchImpl } = {}) {
  const _fetch = fetchImpl || globalThis.fetch;
  if (!websiteUrl) return null;

  const pages = [
    websiteUrl,
    join(websiteUrl, "/contact"),
    join(websiteUrl, "/contact-us"),
    join(websiteUrl, "/about"),
  ].filter(Boolean);

  const found = new Set();
  for (const url of pages) {
    try {
      const res = await _fetch(url, { redirect: "follow" });
      if (!res || !res.ok) continue;
      const html = await res.text();
      const matches = html.match(EMAIL_RE) || [];
      for (const m of matches) {
        if (!SKIP_RE.test(m)) found.add(m.toLowerCase());
      }
    } catch {
      // ignore a page that won't load; try the next
    }
    if (found.size) break; // stop at the first page that yields an address
  }

  return pickBest([...found], websiteUrl);
}

module.exports = { extractEmailFromSite, hostname };
