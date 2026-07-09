// V2 send-layer tests. All offline — no real SMTP, no network.

const { test } = require("node:test");
const assert = require("node:assert");

const {
  createMemoryStore,
  createDryRunSender,
  createResendSender,
  approveAndSend,
} = require("./index");

function compliantAction(overrides = {}) {
  return {
    kind: "send_email",
    from: "jaron@electricnerdz.biz",
    to: "prospect@example.com",
    cleared: true,
    draft: {
      subject: "One small AI chore",
      body: "Hi — https://electricnerdz.biz\nunsubscribe: unsubscribe@electricnerdz.biz",
    },
    ...overrides,
  };
}

test("dry-run: approving logs the message but delivers nothing", async () => {
  const store = createMemoryStore();
  const approval = await store.createApproval({ action: compliantAction() });
  const sender = createDryRunSender();

  const res = await approveAndSend({ store, approvalId: approval.id, sender });

  assert.equal(res.ok, true);
  assert.equal(res.result.delivered, false);
  assert.equal(sender._outbox().length, 1);

  const updated = (await store.listApprovals({}))[0];
  assert.equal(updated.status, "approved_dryrun");
});

test("compliance gate: a non-cleared action is blocked, never sent", async () => {
  const store = createMemoryStore();
  const approval = await store.createApproval({
    action: {
      kind: "send_email",
      cleared: false,
      compliance: { violations: ["placeholder_address"] },
    },
  });
  const sender = createDryRunSender();

  const res = await approveAndSend({ store, approvalId: approval.id, sender });

  assert.equal(res.ok, false);
  assert.equal(res.reason, "not_compliant");
  assert.deepEqual(res.violations, ["placeholder_address"]);
  assert.equal(sender._outbox().length, 0);

  const updated = (await store.listApprovals({}))[0];
  assert.equal(updated.status, "blocked");
});

test("resend adapter delivers via injected fetch", async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return {
      ok: true,
      status: 200,
      async json() {
        return { id: "re_abc123" };
      },
      async text() {
        return "";
      },
    };
  };

  const store = createMemoryStore();
  const approval = await store.createApproval({ action: compliantAction() });
  const sender = createResendSender({ apiKey: "test", fetchImpl: fakeFetch });

  const res = await approveAndSend({ store, approvalId: approval.id, sender });

  assert.equal(res.ok, true);
  assert.equal(res.result.delivered, true);
  assert.equal(res.result.id, "re_abc123");
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].body.to, "prospect@example.com");

  const updated = (await store.listApprovals({}))[0];
  assert.equal(updated.status, "sent");
});

test("idempotency: a sent approval is not sent again", async () => {
  const store = createMemoryStore();
  const approval = await store.createApproval({ action: compliantAction() });
  const sender = createDryRunSender();

  await approveAndSend({ store, approvalId: approval.id, sender });
  // force to sent, then retry
  await store.setApprovalStatus(approval.id, "sent");
  const res = await approveAndSend({ store, approvalId: approval.id, sender });

  assert.equal(res.alreadySent, true);
  assert.equal(sender._outbox().length, 1);
});
