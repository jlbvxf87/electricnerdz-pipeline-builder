// Tests the production draft logic in /lib/pipeline.js (offline, mock Claude).

const { test } = require("node:test");
const assert = require("node:assert");

process.env.OUTREACH_POSTAL_ADDRESS =
  "Electric Nerdz, 4141 Pennsylvania Ave, Suite 203, Kansas City, MO 64111";

const { draftOutreach } = require("../../../lib/pipeline");

const NOW = Date.parse("2026-07-08T12:00:00Z");

const prospects = [
  { company: "Acme Plumbing", email: "info@acme.example", website: "https://acme.example", business_type: "plumbers", email_status: "Ready", sent_count: 0, opt_out: false, reply_status: "" },
  { company: "OptedOut Co", email: "x@opt.example", email_status: "Ready", sent_count: 0, opt_out: true, reply_status: "" },
  { company: "Replied Co", email: "y@replied.example", email_status: "Sent", sent_count: 1, reply_status: "replied", follow_up_date: "2026-07-05" },
];

const mockLLM = {
  async decide() {
    return {
      summary: "x",
      offerAngle: "lead follow-up",
      specificObservation: "after-hours calls to voicemail",
      relevantPainPoint: "missed leads",
      fitScore: 80,
      emailSubject: "One small AI chore for your team",
      emailBody: "Hey there, noticed your after-hours calls go to voicemail. https://electricnerdz.biz — worth a look?",
    };
  },
};

test("draftOutreach drafts only eligible prospects, compliant + footered", async () => {
  const drafts = await draftOutreach(prospects, { llm: mockLLM, now: NOW });

  // Only Acme is eligible (opt-out and replied are filtered).
  assert.equal(drafts.length, 1);
  const d = drafts[0];
  assert.equal(d.prospect.company, "Acme Plumbing");
  assert.equal(d.action.cleared, true);
  assert.match(d.action.body, /electricnerdz\.biz/);
  assert.match(d.action.body, /unsubscribe/i);
  assert.match(d.action.body, /Kansas City/);
  assert.equal(d.action.followUpDate, "2026-07-11"); // first touch +3d
});
