Stage 0 — Plumbing only, no AI yet 
Goal: prove a message can flow end-to-end before any intelligence is involved.

Get a WhatsApp Cloud API test number from Meta (don't wait for full business verification to start coding — sandbox numbers work immediately for dev).
Scaffold the API + Postgres + Redis, deploy to Fly.io/Railway.
Webhook endpoint that verifies the signature, acks in <5s, and just logs the raw payload. Reply with a hardcoded "hello" to any inbound message.
Done when: you can message the test number from your phone and see it round-trip.

Stage 1 — Core AI reply loop, single hardcoded tenant 
Goal: nail the "reply any question 24/7" feature before anything else, for one business only (yours, or a friendly pilot).

Move to async: webhook enqueues a job, a worker processes it — don't call the LLM synchronously in the webhook handler.
Store conversation history, load the last N messages as context.
Wire the Claude API with a solid system prompt for that one business — no tools yet, just conversation.
Build minimal FAQ ingestion: paste text → chunk → embed → pgvector, and wire RAG into the prompt.
Done when: it answers real questions about that one business accurately, without hallucinating prices/policies it doesn't know.

Stage 2 — Guardrails and escalation 
This is what makes it trustworthy enough to hand to a real business, and it's cheap to build now vs. expensive to retrofit after something goes wrong.

escalate_to_human: low confidence, explicit "talk to a human" request, or negative sentiment → notify you directly (a Telegram/WhatsApp ping to yourself is fine, no dashboard needed yet).
Hard system-prompt constraints against inventing prices, promises, or policies — test this adversarially, try to trick your own bot.
Idempotency on Meta's webhook retries (dedupe by message ID) — Meta will redeliver, and without this you'll get duplicate replies in production.

Stage 3 — Make it tenant-shaped, even with just 1–2 tenants 
Introduce tenant_id + RLS + a tenant config table now, even though you only have one customer — this is the expensive thing to retrofit later, cheap to do now.
Build a bare internal tool (even a script) to onboard a new tenant: connect their WA number, paste their FAQ content.
Onboard a second real pilot business using only that tool — this is the actual proof the architecture holds up, not just theory.

Stage 4 — Minimal owner-facing surface 
Bare dashboard: conversation list, manual reply (human takeover), FAQ edit. Skip visual polish, use Clerk/Supabase Auth off the shelf.
This is your "complete working agent" bar: a real business gets accurate 24/7 replies, escalates safely when unsure, and the owner can see and step into conversations.

Only after this runs reliably with 2–3 real pilots for a couple of weeks do you move to the earlier roadmap — booking, then invoicing, then CRM, then follow-ups. The reason for that order specifically: booking and invoicing introduce real business risk (wrong slot, wrong price) that you don't want compounding on top of a conversational core you haven't stress-tested yet. A bot that confidently answers FAQs wrong is embarrassing; a bot that confidently generates a wrong invoice is a churned customer.