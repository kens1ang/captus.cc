Stage 0 — Plumbing only, no AI yet (days 1–3)
Goal: prove a message can flow end-to-end before any intelligence is involved.

Get a WhatsApp Cloud API test number from Meta (don't wait for full business verification to start coding — sandbox numbers work immediately for dev).
Scaffold the API + Postgres + Redis, deploy to Fly.io/Railway.
Webhook endpoint that verifies the signature, acks in <5s, and just logs the raw payload. Reply with a hardcoded "hello" to any inbound message.
Done when: you can message the test number from your phone and see it round-trip.

Stage 1 — Core AI reply loop, single hardcoded tenant (days 4–10)
Goal: nail the "reply any question 24/7" feature before anything else, for one business only (yours, or a friendly pilot).

Move to async: webhook enqueues a job, a worker processes it — don't call the LLM synchronously in the webhook handler.
Store conversation history, load the last N messages as context.
Wire the Claude API with a solid system prompt for that one business — no tools yet, just conversation.
Build minimal FAQ ingestion: paste text → chunk → embed → pgvector, and wire RAG into the prompt.
Done when: it answers real questions about that one business accurately, without hallucinating prices/policies it doesn't know.

Stage 2 — Guardrails and escalation (days 11–14)
This is what makes it trustworthy enough to hand to a real business, and it's cheap to build now vs. expensive to retrofit after something goes wrong.

escalate_to_human: low confidence, explicit "talk to a human" request, or negative sentiment → notify you directly (a Telegram/WhatsApp ping to yourself is fine, no dashboard needed yet). ✅ done — Gemini returns a structured `{reply, escalate, escalate_reason}`, escalation pings OWNER_NOTIFY_NUMBER on WhatsApp.
Hard system-prompt constraints against inventing prices, promises, or policies — test this adversarially, try to trick your own bot. ✅ done — verified it resists prompt injection and won't invent out-of-scope facts.
Idempotency on Meta's webhook retries (dedupe by message ID) — Meta will redeliver, and without this you'll get duplicate replies in production. ✅ done — BullMQ jobId = WhatsApp message id.

Pulled forward into Stage 2 (cheap, and skipping them breaks the product — not deferrable like the rest of this stage's original scope):
- Echo/group-chat filtering — reject messages that appear to echo our own number, or multi-contact (group-like) payloads. Without this a bot can loop-reply to itself or group noise; that's a number-ban-class bug, not a nice-to-have. ✅ done, in webhook.ts.
- Per-contact rate limiting — hard cap on messages/minute per contact (config: RATE_LIMIT_WINDOW_SECONDS / RATE_LIMIT_MAX_MESSAGES), a generic circuit breaker against any reply loop or spam burst regardless of cause. This is also §7 of the architecture doc's non-negotiable list. ✅ done.
- Message buffering/debounce — wait ~7s of silence after the last inbound message before replying, concatenating anything that arrived in that window into one turn, so "hey" / "I wanted to ask" / "about pricing" sent as 3 messages gets one coherent reply instead of three disjointed ones. Implemented as a delayed BullMQ job per contact that gets reset on every new message; only the job that survives the delay untouched actually fires. ✅ done.
- Typing indicator — shown the moment the debounced reply starts processing (native WhatsApp Cloud API call, tied to marking the last inbound message read). ✅ done.
- Basic voice note handling — download the audio, transcribe it with Gemini (multimodal, no separate provider needed), then run the transcript through the normal text pipeline. Images/documents/other types: acknowledged and escalated to a human, never silently dropped — no "smart" media analysis yet. ✅ done.
- Customer memory across sessions — audited, not a gap: conversations/messages are plain Postgres rows keyed by wa_number, confirmed persisting correctly across hours and multiple process restarts. This was already correct per the architecture doc's §4 data model; no fix needed.

Explicitly deferred to Stage 3+ (need real conversation volume / CRM infra this project doesn't have yet):
- Cheap keyword-shortcut routing for 3-5 obvious intents (hours, location, "talk to human") that skip the LLM entirely — worth doing once there's a real pilot's FAQ distribution to hardcode against, not from a guess now.
- Full intent-routing classifier (tiered model routing) — needs real volume to tune.
- Lead qualification (budget/timeline/need questions, contact scoring) — depends on the CRM tagging infra in §5.4 of the architecture doc, which is Stage 3+ work.

Stage 3 — Make it tenant-shaped, even with just 1–2 tenants (days 15–21) — ✅ done (2026-09-01)
Introduce tenant_id + RLS + a tenant config table now, even though you only have one customer — this is the expensive thing to retrofit later, cheap to do now. ✅ done — `tenants` table + tenant_id on conversations/messages/knowledge_chunks. Found and fixed a real gap along the way: the DB role was a Postgres superuser, which silently bypasses RLS entirely (FORCE ROW LEVEL SECURITY doesn't override that) — created a separate restricted `captus_app` role for the app to actually connect as, migrate.ts still uses the superuser for DDL only.
Build a bare internal tool (even a script) to onboard a new tenant: connect their WA number, paste their FAQ content. ✅ done — `npm run onboard -- <phone_number_id> "<name>" "<description>"`, `npm run ingest -- <phone_number_id> <faq.txt>`.
Onboard a second real pilot business using only that tool — this is the actual proof the architecture holds up, not just theory. ✅ done — onboarded "Kopi Corner" (a second dogfood business) via the script alone. Verified real cross-tenant isolation two ways: (1) a raw RLS test (tenant A/B each see only their own rows), (2) a full-pipeline test — asking Kopi Corner's number a Captus-pricing question retrieved zero Captus knowledge chunks and correctly said "don't know," and vice versa. Not assumed — tested.

Stage 4 — Minimal owner-facing surface (days 22–28)
Bare dashboard: conversation list, manual reply (human takeover), FAQ edit. Skip visual polish, use Clerk/Supabase Auth off the shelf.
This is your "complete working agent" bar: a real business gets accurate 24/7 replies, escalates safely when unsure, and the owner can see and step into conversations.

Only after this runs reliably with 2–3 real pilots for a couple of weeks do you move to the earlier roadmap — booking, then invoicing, then CRM, then follow-ups. The reason for that order specifically: booking and invoicing introduce real business risk (wrong slot, wrong price) that you don't want compounding on top of a conversational core you haven't stress-tested yet. A bot that confidently answers FAQs wrong is embarrassing; a bot that confidently generates a wrong invoice is a churned customer.