# WhatsApp AI Business Agent — System Architecture & Tech Stack

A multi-tenant SaaS: SMEs sign up, connect their WhatsApp number, and get an AI agent that handles support, scheduling, invoicing, follow-ups, and payments. Low initial capital, and a path to scale without a rewrite.

---

## 1. High-Level Architecture

```
                        ┌─────────────────────┐
                        │   WhatsApp Cloud API  │
                        │   (Meta, per tenant)   │
                        └──────────┬───────────┘
                                   │ webhook (inbound msgs, status)
                                   ▼
                        ┌─────────────────────┐
                        │   API Gateway / BFF   │  (Fastify/NestJS)
                        │  - webhook verify     │
                        │  - auth (dashboard)   │
                        │  - REST/GraphQL       │
                        └──────────┬───────────┘
                                   │
                  ┌────────────────┼────────────────┐
                  ▼                ▼                 ▼
        ┌─────────────────┐ ┌─────────────┐ ┌──────────────────┐
        │  Message Queue    │ │  Postgres    │ │  Redis (cache +   │
        │  (SQS/BullMQ)     │ │  (per-tenant │ │  session + rate   │
        │                    │ │  schema)     │ │  limiting)        │
        └────────┬──────────┘ └─────────────┘ └──────────────────┘
                  │
                  ▼
        ┌───────────────────────────────────────────┐
        │        Conversation Orchestrator Worker       │
        │  - loads tenant config + conversation state   │
        │  - RAG lookup (FAQ / knowledge base)           │
        │  - LLM call w/ function-calling (tools)        │
        │  - routes to module handlers below             │
        └───────────────────────────────────────────┘
                  │
    ┌─────────────┼─────────────┬─────────────┬────────────────┐
    ▼             ▼             ▼             ▼                ▼
┌────────┐  ┌───────────┐ ┌──────────┐ ┌────────────┐  ┌──────────────┐
│Booking │  │ Invoicing │ │  CRM /    │ │  Follow-up  │  │  Human        │
│Module  │  │ / Payments│ │  Contacts │ │  Scheduler  │  │  Handover     │
└────────┘  └───────────┘ └──────────┘ └────────────┘  └──────────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │  Owner Dashboard      │  (Next.js)
                        │  analytics, inbox,    │
                        │  team, settings        │
                        └─────────────────────┘
```

Core principle: **the WhatsApp webhook path stays thin and fast** (verify, enqueue, ack in <5s — Meta requires quick response), and all the actual work (LLM calls, DB writes, external API calls) happens in async workers. This is the single most important architectural decision — get it wrong and you'll get webhook timeouts and dropped messages at any real volume.

---

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere (backend + frontend) | You're 2 engineers — one language end-to-end reduces context switching and lets either of you touch any part of the codebase. |
| API/backend | **NestJS** (or Fastify if you want lighter-weight) | NestJS gives you DI, modules, guards, decorators out of the box — maps directly onto "modules" (booking, invoicing, CRM) as separate Nest modules. Good structure discipline for a small team that won't have time for heavy code review. |
| Queue/workers | **BullMQ** (Redis-backed) to start; **AWS SQS + Lambda/ECS** if you outgrow single-box Redis | BullMQ is trivial to run early, has retries/backoff/dead-letter built in. Swap to SQS only when you need durability guarantees Redis can't give you. |
| Database | **PostgreSQL** (managed — Supabase, Neon, or RDS) | Relational fits this domain well (tenants, contacts, bookings, invoices, messages all relate). Use **row-level security** or schema-per-tenant for isolation (see §5). |
| Vector store (for FAQ/RAG) | **pgvector extension on the same Postgres** | Don't stand up a separate vector DB (Pinecone/Weaviate) until you have a real reason. pgvector inside Postgres keeps ops simple and is plenty fast at SME data volumes (hundreds to low-thousands of FAQ chunks per tenant). |
| Cache/session/rate-limit | **Redis** | Also backs BullMQ, so it's one piece of infra doing two jobs. |
| LLM | **Claude (Anthropic API)**, via Messages API with **tool use** for function-calling | Tool use is what lets the model actually *do* things (book, invoice, escalate) instead of just replying in text. Use a cheaper/faster model (e.g. Haiku-tier) for simple FAQ turns and escalate to a stronger model for ambiguous/multi-step requests, to control cost. **MVP build note:** using Gemini (free tier) instead of Claude for Stages 1-2, for cost reasons while validating the product — structured JSON output (not tool-use) drives the `escalate` decision today. Revisit before Stage 3+ tool-calling (booking/invoicing) lands, since that needs a real function-calling loop. |
| WhatsApp integration | **Meta WhatsApp Cloud API directly**, not a 3rd-party wrapper (Twilio etc.) | Direct integration avoids markup fees on every message and gives you full access to templates, interactive buttons, and webhook payloads. Twilio is easier initially but becomes a real cost line as you scale message volume — worth the extra week of integration work upfront. |
| Payments | **Stripe** (international) + **local PSP for DuitNow/PayNow QR** (e.g. Billplz, HitPay, or Stripe's regional partners in SG) | HitPay in particular is popular for SG/MY SME QR payments and has decent APIs. Keep payment provider behind an internal `PaymentProvider` interface so you can swap/add providers without touching module logic. |
| Owner dashboard | **Next.js** + **shadcn/ui** + **Tailwind** | Fast to build, server components for the data-heavy dashboard views, good DX for a small team. |
| Auth | **Clerk** or **Supabase Auth** (don't roll your own) | Multi-tenant auth with team/roles support out of the box — this is exactly the kind of thing that eats weeks if built from scratch and isn't your differentiator. |
| Hosting | **Fly.io or Railway** to start; migrate to **AWS (ECS/Fargate)** once revenue justifies the ops overhead | Both let you deploy containers cheaply with minimal DevOps. Don't reach for Kubernetes at this stage — it's pure overhead for a 2-person team pre-PMF. |
| Observability | **Sentry** (errors) + **Axiom or Better Stack** (logs) + **OpenTelemetry** traces once you have workers | Cheap, fast to wire up, and conversation-flow bugs (a booking that silently fails) are exactly the kind of thing you need traced, not just logged. |
| CI/CD | **GitHub Actions** → build/test/deploy on merge to main | Standard, free tier is enough at this scale. |

**Capital-light note:** everything above except the LLM API calls and phone number verification (Meta requires a small verified business + phone) has a generous free tier. Your actual monthly burn pre-revenue should be mostly LLM token costs, which you control by model tiering and by capping conversation context length.

---

## 3. Multi-Tenancy Model

This is the decision that's hardest to change later, so get it right early.

**Recommended: shared database, shared schema, `tenant_id` on every table + Postgres Row-Level Security (RLS).**

- Every table (`contacts`, `conversations`, `messages`, `bookings`, `invoices`) has a `tenant_id` column.
- RLS policies enforce `tenant_id = current_setting('app.tenant_id')` at the database level, not just in application code — this means even a bug in your app code can't leak one tenant's data into another's queries.
- Set `app.tenant_id` per request/job via `SET LOCAL` inside a transaction, derived from the authenticated tenant or the WhatsApp phone number ID on inbound webhooks.
- ✅ Live since Stage 3 (2026-09-01), verified with a real cross-tenant test, not assumed. One gotcha worth remembering for any future Postgres setup: `FORCE ROW LEVEL SECURITY` does NOT bind a superuser — Postgres superusers bypass RLS unconditionally. The app must connect as a plain non-superuser role (`captus_app` here) or the policies are silently a no-op. `db/tenantContext.ts`'s `withTenant()` is the one place `SET LOCAL app.tenant_id` happens; `db/pool.ts` is the restricted-role connection everything else uses.

Why not schema-per-tenant or database-per-tenant: with SME customers you'll have dozens-to-hundreds of tenants with low individual data volume. Schema/DB-per-tenant adds massive migration and connection-pooling overhead for no real isolation benefit at this scale. Revisit only if you land an enterprise client demanding hard data isolation.

---

## 4. Core Data Model (simplified)

```
tenants (id, business_name, whatsapp_phone_id, plan, settings jsonb, created_at)
users (id, tenant_id, email, role)                -- dashboard/team logins
contacts (id, tenant_id, wa_number, name, tags[], crm_notes, created_at)
conversations (id, tenant_id, contact_id, status, assigned_to, last_message_at)
messages (id, conversation_id, direction, type, content, tool_calls jsonb, created_at)
knowledge_chunks (id, tenant_id, content, embedding vector(1536), source)
bookings (id, tenant_id, contact_id, service, start_time, status, reminder_sent_at)
invoices (id, tenant_id, contact_id, line_items jsonb, amount, status, payment_link, paid_at)
follow_up_rules (id, tenant_id, trigger_event, delay_hours, template)
follow_up_jobs (id, rule_id, contact_id, scheduled_for, status)
```

Keep `messages.tool_calls` as jsonb logging exactly what the LLM decided to invoke and with what arguments — this is your audit trail when a customer disputes "the bot booked me for the wrong time" and it's invaluable for debugging prompt/tool issues.

---

## 5. Module-by-Module Implementation Notes

### 5.1 Conversation Orchestrator (the core)
- Inbound webhook → enqueue job with `{tenant_id, wa_number, message}` → ack Meta within 5s.
- Implemented at MVP stage (ahead of schedule, because skipping them breaks the product): echo/group-chat filtering, per-contact rate limiting (a generic circuit breaker against reply loops — see §7), message buffering/debounce (~7s of silence before replying, so a burst of separate messages gets one coherent reply), a typing indicator shown when the debounced reply starts processing, and basic voice-note transcription (Gemini multimodal, no separate provider) — other media types are acknowledged and escalated, never silently dropped.
- Worker picks up job: loads last N messages of conversation for context (cap this — don't send unbounded history to the LLM, both for cost and latency).
- Runs a RAG lookup against `knowledge_chunks` (pgvector cosine similarity) for FAQ-type queries, injects top-k chunks into the system prompt.
- Calls Claude with **tool definitions** for: `create_booking`, `generate_invoice`, `send_payment_link`, `escalate_to_human`, `update_contact_tag`, `search_knowledge_base`. The model decides which tool(s) to call based on the conversation; your worker executes them and returns results, then the model produces the final reply.
- This tool-use loop (call → execute → return result → model replies) is the actual "agent" part — it's what separates this from a static chatbot.

### 5.2 Booking/Scheduling
- Sync with **Google Calendar API** (most SMEs already use it) as the source of truth for availability, rather than building your own calendar from scratch.
- Booking tool checks availability, proposes 2-3 slots via WhatsApp interactive buttons, confirms, writes to `bookings` + calendar event.
- Reminder job (BullMQ delayed job or a cron worker scanning `bookings` for `start_time - 24h` / `-1h`) sends WhatsApp template reminders with reschedule/cancel buttons.

### 5.3 Invoicing & Payments
- `generate_invoice` tool builds line items from the conversation (or a pre-set service price list configured by the tenant), creates an `invoices` row, generates a payment link via the `PaymentProvider` interface (Stripe or HitPay/Billplz), sends it in-chat.
- Payment webhook (from Stripe/HitPay) → marks invoice paid → triggers a confirmation message and any post-payment automation (e.g. booking confirmation).
- **Never let the LLM freehand a price.** Prices/line items should come from a tenant-configured price list or explicit human confirmation step for anything above a threshold you set — this is the #1 place an LLM agent can cost a business real money if left unconstrained.

### 5.4 CRM / Contacts
- Auto-created on first inbound message from a new WhatsApp number.
- Tags applied by tool calls (`update_contact_tag`) based on conversation content (e.g. "hot lead", "VIP", "complaint").
- Dashboard search/filter over `contacts` + join to `bookings`/`invoices` for purchase history.

### 5.5 Follow-up Engine
- Rule-based: e.g. "if invoice sent and unpaid after 24h → send reminder", "if quote given and no reply after 48h → nudge". Stored as `follow_up_rules` per tenant, executed by scheduled `follow_up_jobs`.
- This is a standard delayed-job pattern — don't overthink it into a separate "workflow engine" until you have enough rule complexity to justify it (e.g. Temporal.io is overkill at MVP stage).

### 5.6 Human Handover
- MVP version (live now): no `conversations.status` column or dashboard yet — the LLM returns an `escalate` flag directly in its structured reply, and that pings the owner's own WhatsApp number. Good enough pre-Stage-4; the version below is the real one once there's a dashboard.
- `escalate_to_human` tool flips `conversations.status` to `needs_human`, pushes a real-time notification (WebSocket or simple polling) to the dashboard inbox.
- Dashboard inbox shows full conversation + CRM context so the human doesn't start cold — this is the detail that makes the product feel professional rather than "just a bot with an off switch."
- While a human is engaged, the orchestrator should **not** auto-reply — check `conversations.status` before invoking the LLM on new inbound messages.

### 5.7 Analytics Dashboard
- Precompute daily rollups (response time, resolved-by-bot %, conversion rate, top FAQ topics) in a scheduled job rather than querying raw `messages` live — keeps the dashboard fast as message volume grows.

---

## 6. Scaling Path (don't build this now, but design so it's possible later)

1. **0–50 tenants:** Single Fly.io/Railway app + worker process, managed Postgres, BullMQ on the same Redis. This is genuinely enough for a long time.
2. **50–500 tenants:** Split API and workers into separate deployables so you can scale worker concurrency independently of webhook latency. Move to SQS if BullMQ/Redis becomes a bottleneck or you need stricter delivery guarantees.
3. **500+ tenants / enterprise clients:** Consider dedicated resources (schema or DB isolation) for large clients specifically, keep the rest on shared multi-tenant infra. Add read replicas for analytics queries so they don't compete with transactional load.

The RLS + tenant_id design from §3 means none of these transitions require a data model rewrite — that's the point of getting the multi-tenancy call right early.

---

## 7. Security & Compliance Notes (non-negotiable, not optional polish)

- **Webhook signature verification** on every inbound Meta webhook (X-Hub-Signature-256) — reject unsigned/invalid requests.
- **RLS on every tenant table**, tested with actual cross-tenant access attempts in CI, not just assumed.
- **PII handling**: WhatsApp conversations contain customer PII (names, numbers, sometimes payment info in text). Encrypt at rest (managed Postgres providers generally do this by default — verify), and don't log full message content to third-party logging services without redaction.
- **Rate limiting** per tenant on outbound messages — protects you from a runaway loop (e.g. bot stuck replying to itself or a bug triggering repeated sends) getting your WhatsApp Business number banned by Meta, which is an existential risk for this business model. ✅ done at MVP stage: per-contact rate limit + echo/group-payload filtering, ahead of the original Stage 3 schedule.
- **Meta template approval**: any proactive message (reminders, follow-ups, broadcasts) outside the 24h customer-service window requires pre-approved message templates. Build your follow-up/reminder module around this constraint from day one, not as a retrofit.

---

## 8. Suggested Build Order (MVP → sellable product)

1. Meta Cloud API webhook + basic orchestrator with one tool (`search_knowledge_base`) — get a working FAQ bot end-to-end first.
2. Add booking tool + Google Calendar sync.
3. Add invoicing + one payment provider.
4. Add human handover + minimal dashboard inbox.
5. Add follow-up engine.
6. Add CRM tagging + analytics rollups.
7. Multi-tenant onboarding flow (self-serve WhatsApp number connection) — this is often harder than it sounds because of Meta's business verification process, so validate it early with your first pilot customer rather than leaving it to the end.

