# Archive

Early planning docs, kept for reference. They are **not** an accurate description of the code today.

| File | What it was | What changed since |
|---|---|---|
| `whatsapp-agent-architecture.md` | The original system design (Aug 2026). | Gemini instead of Claude. Fastify instead of NestJS. Render + Neon + Vercel instead of Fly/Railway. Invoicing, payments, follow-ups and CRM tagging were never built. The multi-tenancy (RLS), webhook → queue → worker flow and pgvector RAG parts still hold. |
| `mvp-plan.md` | The staged build order (Stage 0–4). | All stages are done. Booking, documents, templates and the dashboard went further than the plan. |
| `sample-faq-captus.txt` | Example FAQ text for `npm run ingest`. | The dashboard's Knowledge pages replace this. Pricing and "coming soon" lines are made up and out of date. |

For what the product does now, and ideas for later, see [`../../FEATURES.md`](../../FEATURES.md).
