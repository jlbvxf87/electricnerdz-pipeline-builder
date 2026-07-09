// Offline test of the lead-finder: mock Google Places + mock business websites.
// No API key, no network.

const { test } = require("node:test");
const assert = require("node:assert");

const { searchBusinesses } = require("./google-places");
const { extractEmailFromSite } = require("./email-extractor");
const { findLeads } = require("./lead-finder");

// --- Fake data ---------------------------------------------------------------
const PLACES = {
  places: [
    { id: "1", displayName: { text: "Acme Plumbing" }, websiteUri: "https://acmeplumbing.example", nationalPhoneNumber: "(816) 555-0101", formattedAddress: "1 Main St, Kansas City, MO" },
    { id: "2", displayName: { text: "BrightFlow HVAC" }, websiteUri: "https://brightflow.example", nationalPhoneNumber: "(816) 555-0102", formattedAddress: "2 Oak St, Kansas City, MO" },
    { id: "3", displayName: { text: "No Site Co" }, websiteUri: "", nationalPhoneNumber: "(816) 555-0103", formattedAddress: "3 Elm St, Kansas City, MO" },
    { id: "4", displayName: { text: "Hidden Email LLC" }, websiteUri: "https://hidden.example", nationalPhoneNumber: "(816) 555-0104", formattedAddress: "4 Pine St, Kansas City, MO" },
  ],
};

const SITES = {
  "https://acmeplumbing.example": "<footer>Call us or email info@acmeplumbing.example today</footer>",
  "https://brightflow.example": "<p>Reach the team at hello@brightflow.example or sales@brightflow.example</p>",
  "https://hidden.example": "<p>Use our contact form.</p>", // no email anywhere
};

function mockFetch(url, opts) {
  if (String(url).includes("places.googleapis.com")) {
    return Promise.resolve({ ok: true, status: 200, async json() { return PLACES; }, async text() { return ""; } });
  }
  // website fetch: match a known site by prefix; contact/about subpaths 404
  const base = Object.keys(SITES).find((s) => String(url) === s);
  if (base) {
    return Promise.resolve({ ok: true, status: 200, async text() { return SITES[base]; } });
  }
  return Promise.resolve({ ok: false, status: 404, async text() { return ""; } });
}

// --- Tests -------------------------------------------------------------------
test("google-places parses businesses from the API response", async () => {
  const rows = await searchBusinesses({ niche: "plumbers", city: "Kansas City", apiKey: "x", fetchImpl: mockFetch, limit: 10 });
  assert.equal(rows.length, 4);
  assert.equal(rows[0].company, "Acme Plumbing");
  assert.equal(rows[0].website, "https://acmeplumbing.example");
});

test("email extractor pulls a published email and prefers a role inbox on-domain", async () => {
  const email = await extractEmailFromSite("https://brightflow.example", { fetchImpl: mockFetch });
  assert.equal(email, "hello@brightflow.example"); // prefers hello@ over sales@
});

test("email extractor returns null when no email is published", async () => {
  const email = await extractEmailFromSite("https://hidden.example", { fetchImpl: mockFetch });
  assert.equal(email, null);
});

test("findLeads shapes prospect rows, skips no-website / no-email, dedupes", async () => {
  const { leads, skipped } = await findLeads({
    niche: "plumbers",
    city: "Kansas City",
    limit: 25,
    existingDomains: [],
    apiKey: "x",
    fetchImpl: mockFetch,
  });

  // Acme + BrightFlow have emails; No Site (no website) and Hidden (no email) drop.
  assert.equal(leads.length, 2);
  assert.equal(skipped.no_website, 1);
  assert.equal(skipped.no_email, 1);

  const acme = leads.find((l) => l.company === "Acme Plumbing");
  assert.equal(acme.email, "info@acmeplumbing.example");
  assert.equal(acme.email_status, "Ready");
  assert.equal(acme.business_type, "plumbers");
});

test("findLeads dedupes against existing domains", async () => {
  const { leads } = await findLeads({
    niche: "plumbers",
    city: "Kansas City",
    existingDomains: ["acmeplumbing.example"],
    apiKey: "x",
    fetchImpl: mockFetch,
  });
  assert.ok(!leads.some((l) => l.company === "Acme Plumbing"));
});

test("findLeads respects the daily limit", async () => {
  const { leads } = await findLeads({ niche: "plumbers", city: "Kansas City", limit: 1, apiKey: "x", fetchImpl: mockFetch });
  assert.equal(leads.length, 1);
});
