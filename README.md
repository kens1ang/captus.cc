# Captus

A WhatsApp AI assistant for small businesses (captus.cc). A business connects its WhatsApp number. Captus answers customers 24/7 from the business's own knowledge base, takes bookings, sends documents, and hands the chat to a person when it should.

What it does today and what could come next: **[FEATURES.md](FEATURES.md)**.

## Layout

| Path | What |
|---|---|
| `src/` | Backend: Fastify API + BullMQ workers, one process (`src/main.ts`) |
| `src/routes/` | Meta webhook, dashboard API, admin API, Google OAuth, document downloads |
| `src/lib/` | AI reply loop (`gemini.ts`, `llmFallback.ts`, `systemPrompt.ts`), booking, templates, reminders, WhatsApp client |
| `src/db/` | Postgres access + `schema.sql` (every tenant table uses Row Level Security) |
| `src/scripts/` | CLI helpers (`onboard`, `ingest`, `link-user`, `status`, `create-reminder-template`) |
| `dashboard/` | Owner dashboard (Next.js + Clerk). See [dashboard/README.md](dashboard/README.md) |
| `landing/` | Static marketing site for captus.cc |
| `e2e/` | End-to-end stress harness (mock Meta, real Gemini) |
| `docs/archive/` | Original architecture and MVP plan, kept for reference only |

## Run locally

```bash
docker compose up -d          # Postgres (pgvector) + Redis
cp .env.example .env          # fill in WhatsApp, Gemini and Clerk keys
npm install
npm run migrate
npm run dev                   # API on :3000
npm run dev:worker            # workers (separate terminal)
```

To get Meta's webhooks to your machine, run a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`). Then set `<tunnel>/webhook` as the callback in the Meta app.

## Tests

```bash
npm run typecheck
npm run e2e                   # all phases; needs Docker Desktop
npm run e2e scenarios         # or: failures | load
E2E_ONLY=booking npm run e2e  # one scenario by name
```

The e2e run uses the real `GEMINI_API_KEY`, and a full run uses a large share of the free daily quota.

## Production

| Piece | Where |
|---|---|
| Backend + workers | Render free web service `captus-backend` (Singapore), `api.captus.cc`, from `render.yaml` |
| Redis | Render free Key Value `captus-redis`. **No persistence**: queued jobs are lost on restart. Reminders are rebuilt from the DB at startup. |
| Postgres | Neon free, ap-southeast-1 |
| Dashboard | Vercel project `captus-cc`, `app.captus.cc` |
| Landing | Vercel, `captus.cc` |
| Uptime | UptimeRobot pings `https://api.captus.cc/health` every 5 min (keeps Render's free tier awake) |

Pushing to `main` deploys everything. Migrations run on every boot (they're idempotent). Operator alerts show up in the Render logs as `[OPS ALERT]` and are sent to `OWNER_NOTIFY_NUMBER` on WhatsApp.
