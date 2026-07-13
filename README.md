# Pipeline Builder Agent

**An always-on AI prospecting agent.** It finds local businesses, drafts a personalized intro email for each with Claude, and sends **only what you approve** — every weekday, from your own mailbox, fully logged.

Built by [Electric Nerdz](https://electricnerdz.biz). This is the exact agent we run to fill our own pipeline.

> A chatbot answers. An **action agent** does one job and leaves proof.

---

## What it does

```
Vercel cron → find ~25 businesses (Google Places) → grab their published email
   → save to Supabase → Claude writes each email → rules + CAN-SPAM check
   → email / Telegram you a one-tap "Approve & send" → Zoho sends → log + schedule follow-up
```

Nothing sends without your approval. It auto-stops chasing anyone who replies or opts out, caps daily volume, and requires a compliant footer — the guardrails are **enforced in code**, not just asked for in the prompt.

## Built on C.H.O.R.E.

Every Electric Nerdz agent follows the same recipe:

- **C — Chore:** find prospects and write outreach, one email at a time
- **H — Head:** Claude (the Anthropic API) loaded with your offer, tone, links, and ideal customer
- **O — Output:** a personalized email, a follow-up date, an owner alert, and a log line
- **R — Rules:** no opt-outs, no misleading claims, stop after a reply, daily cap, CAN-SPAM footer
- **E — Evidence:** every draft saved as pending, with approval token, sent timestamp, and follow-up

## The stack

| Piece | Job |
| --- | --- |
| Google Places API | Find local businesses (official, no scraping) |
| Website self-extract | Read each business's own site for its published email |
| Supabase (Postgres) | Store prospects + drafts awaiting approval |
| Anthropic Claude | Write each email (the Head) |
| Vercel | Serverless endpoints + daily cron |
| Zoho SMTP | Send cold outreach from your real mailbox |
| Resend | Owner alerts + warm mail |
| Telegram (optional) | Tap-to-approve from your phone |

## The agent library

Pipeline Builder is one of a growing library of action agents that all share the
same runtime, the same approval layer, and the same stop signs:

| Agent | Chore | Status |
| --- | --- | --- |
| **Pipeline Builder** (`agents/pipeline-builder/`) | Finds leads, drafts personalized outreach, sends only what you approve | Live |
| **Meeting Follow-Up** (`agents/meeting-follow-up/`) | Turns meeting notes into a follow-up email, task list, and decision log | Live |
| **Lead Truth** (`agents/lead-truth/`) | Judges whether inbound leads are actually worth your time — not just what a platform score claims — and drafts replies for the real ones | Live |

Every agent is the same five-step shape (`Read → Decide → Act → Approve → Log`)
run by one shared loop, and **nothing sends without a human tap on Approve** —
delivered to your email and Telegram as one-click links. `agent-lab/README.md`
documents how to build the next one.

## Layout

```
agent-lab/                 the tested runtime + agents (no build step, no deps to run tests)
  packages/agent-core/     Read → Decide → Act → Approve → Log loop, llm, senders,
                           memory + Supabase stores, notify (email/Telegram), deliver
  packages/connectors/     Google Places, email extractor, lead finder, leads table
  agents/pipeline-builder/ manifest, prompt, schema, eligibility, compliance, fixtures, tests
  agents/meeting-follow-up/  the reference agent — notes in, gated follow-up out
  agents/lead-truth/       honest lead-quality verdicts + gated follow-up drafts
lib/                       pipeline.js (draft logic), pipeline-db.js (Supabase), telegram.js
api/                       Vercel endpoints: leads-find, pipeline-run, pipeline-approve,
                           agent-run, agent-approve, agent-reject (the shared layer),
                           check-replies, morning-prompt, telegram (webhook)
supabase/                  SQL migrations (run these once)
```

## Quick start

You'll need free/low-cost accounts: **Supabase, Vercel, Google Cloud (Places API), Anthropic, Zoho Mail, Resend.**

1. **Clone & install**
   ```bash
   git clone https://github.com/jlbvxf87/electricnerdz-pipeline-builder
   cd electricnerdz-pipeline-builder
   npm install
   ```
2. **Prove the guardrails** (offline, no keys needed)
   ```bash
   npm test        # runs the agent-lab tests
   ```
3. **Set up the database** — in the Supabase SQL editor, run each file in `supabase/` in order.
4. **Add your keys** — copy `.env.example` → `.env.local` and fill it in (see the file for what each does). Add the same values to your Vercel project's Environment Variables.
5. **Deploy to Vercel** — import this repo. The crons in `vercel.json` start the daily loop.
6. **Test it live**
   ```
   https://YOUR-APP.vercel.app/api/leads-find?secret=YOUR_CRON_SECRET&niche=HVAC%20contractors&city=Kansas%20City
   https://YOUR-APP.vercel.app/api/pipeline-run?secret=YOUR_CRON_SECRET
   ```
   Then check your inbox / Telegram for a draft with an **Approve & send** button.

## Safety & compliance

- **Nothing sends without a human approval.** The send step refuses any draft that fails the compliance check.
- **CAN-SPAM:** every email carries a valid postal address + opt-out. Set `OUTREACH_POSTAL_ADDRESS` — the code blocks sending until it's real.
- **No scraping.** Leads come from the official Places API and businesses' own public sites. Not legal advice — confirm the rules for your recipients and jurisdictions.
- Use a **separate outreach domain** for cold sending so it never affects the reputation of the domain that sends your customer email.

## Rather have it installed for you?

Standing this up — keys, deliverability, scoping the prompt to your business, connecting your tools — is a real project. That's what we do.
**[electricnerdz.biz](https://electricnerdz.biz)** · AI systems. Human touch.

## License

MIT — see [LICENSE](./LICENSE).
