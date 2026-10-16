# Captus dashboard

The business owner's dashboard: Next.js (App Router) + Clerk + Tailwind. Live at `app.captus.cc` (Vercel project `captus-cc`, root directory `dashboard`, functions pinned to `sin1`).

```bash
npm install
npm run dev     # http://localhost:3001, expects the backend on :3000
```

Copy `.env.local.example` to `.env.local` and fill in the Clerk keys and `BACKEND_API_URL`.

- `app/`: one folder per page (overview, conversations, bookings, knowledge, documents, templates, settings, admin).
- `lib/data.ts`: every backend API call the pages make.
- `components/ui.tsx`: shared building blocks (Page, Card, Badge, Button…).

`AGENTS.md` / `CLAUDE.md` are written by `next dev` itself. Leave them alone.
