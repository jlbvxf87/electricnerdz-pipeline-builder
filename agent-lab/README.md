# Electric Nerdz — Agent Lab

This is where the action agents we sell on the site actually get built.

An **action agent** is one AI worker with one chore. Every agent is the same
five-step shape, so one runtime runs all of them:

```
Read → Decide → Draft/Act → Ask Approval → Log
```

Those five words are the product promise on the homepage — this repo is the code
behind them.

## Layout

```
agent-lab/
├─ packages/
│  └─ agent-core/         the shared runtime
│     ├─ runner.js        the Read→Decide→Act→Approve→Log loop
│     ├─ llm.js           Anthropic (Claude) Decide step, via tool-use
│     ├─ store.js         run/log/approval storage (memory now, Supabase later)
│     └─ index.js
├─ agents/
│  └─ meeting-follow-up/  the reference agent
│     ├─ manifest.json    name, reads, creates, stop signs — mirrors the site card
│     ├─ prompt.md        the system prompt
│     ├─ schema.js        structured Decide output
│     ├─ agent.js         read / decide / act / needsApproval
│     ├─ fixtures/        fake data for the "test with fake data" step
│     └─ agent.test.js    offline test of the whole loop
├─ run.js                 run an agent live against fixtures (needs API key)
└─ package.json
```

## The manifest is the contract

`manifest.json` uses the exact fields shown on the site — **Reads / Creates /
Stop signs** — so marketing and code can never drift:

```json
{
  "title": "Meeting Follow-Up Agent",
  "reads": ["Notes / transcripts"],
  "creates": ["Follow-up email", "Task list", "Open questions", "Decision log"],
  "stopSigns": ["Does not send without approval"]
}
```

## Run it

No dependencies to install — Node 18+ only.

Test the whole loop offline (a mock stands in for Claude, no key needed):

```bash
cd agent-lab
npm test
```

Run it live against the fake meeting notes (real Claude Decide step):

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run run:meeting
```

Either way, **nothing is sent** — every send action lands as a `pending`
approval. That is the stop sign, enforced by the runtime, not by trust.

## Add another agent

Copy `agents/meeting-follow-up/`, then for the new chore edit: `manifest.json`
(the card), `prompt.md` (the instructions), `schema.js` (the output shape),
`agent.js` (read/act + which actions need approval), and `fixtures/` (fake data
to test with). The remaining five from the site — Lead Truth, Ad Spend Guardian,
No-Show Recovery, Review Request, Weekly Operator Report — each drop into this
same shape.

## From here to production

- **Connectors** — replace fixture reads with real adapters (Gmail, Sheets,
  CRM, Calendar, Ads). Add them under `packages/connectors/`.
- **Store** — swap `createMemoryStore()` for a Supabase-backed store using the
  same interface (`saveRun`, `appendLog`, `createApproval`, `setApprovalStatus`).
- **Approvals UI** — surface pending approvals in the operator dashboard (or via
  one-click email links) so a human approves before anything goes out.
- **Triggers** — run agents on a Vercel Cron or a webhook.
- **Student library** — a trimmed template of this repo becomes the "Private
  GitHub library" Operator School grants on subscription.

## Sending (V2) — the sender adapter layer

Agents only *draft* actions. Delivery is a separate, approval-gated step so the
compliance guardrails can never be bypassed by clicking approve.

`approveAndSend({ store, approvalId, sender })` refuses any action that isn't
`cleared: true` (compliance passed), then hands the message to a sender adapter:

| Adapter | Use for | Setup |
| --- | --- | --- |
| `createDryRunSender()` | default — logs, sends nothing | none |
| `createResendSender()` | warm/transactional agents | `RESEND_API_KEY` |
| `createZohoSmtpSender()` | cold outreach from your Zoho mailbox | `ZOHO_SMTP_USER` / `ZOHO_SMTP_PASS` (+ `npm i nodemailer`) |

Electric Nerdz mailbox is on **Zoho** (cold outreach) and **Resend** (warm mail),
so the split is: Pipeline Builder → Zoho SMTP, everything else → Resend. Nothing
sends until you set those credentials — the default dry-run adapter just logs.

**Internal vs external is a config choice, not a code change.** Point the sender
+ prospect list at your own mailbox to run Electric Nerdz's pipeline; point them
at a client's mailbox to sell it as an install. Same runtime.

### Still to come
- **V3:** reply detection (Zoho IMAP) to auto-stop follow-ups, + write status
  back to the sheet/CRM.
- **Connectors:** a live Google Sheet / CSV reader to replace fixtures.
- **Approvals UI:** surface pending drafts in the operator dashboard.
