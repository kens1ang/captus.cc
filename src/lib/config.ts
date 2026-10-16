import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

/** `GEMINI_MODELS=a,b,c` wins; else a legacy single-model var goes first, ahead of the defaults (deduped). */
function modelChain(list: string | undefined, legacySingle: string | undefined, defaults: string[]): string[] {
  const fromList = list?.split(",").map((m) => m.trim()).filter(Boolean);
  if (fromList?.length) return fromList;
  return [...new Set([legacySingle?.trim(), ...defaults].filter((m): m is string => !!m))];
}

// Local dev default for the restricted app role migrate.ts creates — override
// via APP_DB_PASSWORD if this DB is ever reachable from outside your machine.
const appDbPassword = process.env.APP_DB_PASSWORD || "captus_app_dev";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  // Owner/superuser connection — DDL only (migrate.ts). The Postgres image's
  // POSTGRES_USER is a superuser, and superusers bypass Row Level Security
  // entirely regardless of FORCE ROW LEVEL SECURITY — so the running app must
  // never use this for tenant-scoped queries, or RLS enforces nothing.
  databaseUrl: process.env.DATABASE_URL ?? "postgres://captus:captus@localhost:5432/captus",
  // What the running app (server, worker, scripts) actually connects as — a
  // plain non-superuser role, so RLS's tenant_isolation policy actually
  // applies. Created/granted by migrate.ts.
  appDatabaseUrl: process.env.APP_DATABASE_URL ?? `postgres://captus_app:${appDbPassword}@localhost:5432/captus`,
  appDbPassword,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  // App-level Meta config (one Meta app/webhook serves every tenant, routed by
  // phone_number_id in the payload — see db/tenants.ts). accessToken is also
  // still global: all tenants share one Meta app/business portfolio for now,
  // per-tenant tokens would need a real OAuth onboarding flow (Stage 4+).
  // whatsappPhoneNumberId is deliberately NOT here — that's per-tenant, in the
  // tenants table (WHATSAPP_PHONE_NUMBER_ID env var is only used once, to seed
  // the default tenant in migrate.ts).
  whatsapp: {
    get accessToken() {
      return required("WHATSAPP_ACCESS_TOKEN");
    },
    get verifyToken() {
      return required("WHATSAPP_VERIFY_TOKEN");
    },
    get appSecret() {
      return required("WHATSAPP_APP_SECRET");
    },
    // Only the e2e harness overrides this (to a local mock of Meta's API).
    graphBase: process.env.WHATSAPP_GRAPH_BASE || "https://graph.facebook.com",
  },
  gemini: {
    get apiKey() {
      return required("GEMINI_API_KEY");
    },
    // Fallback chains, tried in order (lib/llmFallback.ts) — a model that's
    // overloaded, rate-limited, out of quota or retired is skipped for a
    // while and the next one answers instead. Comma-separated env override.
    // Only stable models: previews get lower limits and vanish without
    // notice (2.5 Flash went 404 "no longer available to new users" with no
    // warning). Probed 2026-10-16: 3.5 Flash-Lite ~1.2s, 3.5 Flash ~2.6s;
    // 3.8 Flash answered correctly but took 169s, so it's not in here.
    // GEMINI_MODEL / GEMINI_TRANSCRIBE_MODEL (the old single-model vars)
    // still work and just become the head of the chain.
    replyModels: modelChain(process.env.GEMINI_MODELS, process.env.GEMINI_MODEL, [
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
    ]),
    // Voice notes, photos, documents.
    mediaModels: modelChain(process.env.GEMINI_MEDIA_MODELS, process.env.GEMINI_TRANSCRIBE_MODEL, [
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
    ]),
    // Deliberately a single model with no fallback: vectors from different
    // embedding models aren't comparable, so silently switching would break
    // search against everything already stored. On failure, replies skip the
    // FAQ lookup instead (worker.ts).
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001",
  },
  // Where operator alerts go (Gemini key/billing/quota problems, every model
  // failing) — these are YOUR problems as the operator, not the business
  // owner's. Sent to OWNER_NOTIFY_NUMBER from this WhatsApp number.
  opsAlertPhoneNumberId: process.env.OPS_ALERT_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || undefined,
  // Stage 4: dashboard auth (Clerk) — secretKey verifies session tokens sent
  // by the Next.js dashboard; dashboardOrigin is the CORS allowlist entry.
  clerk: {
    get secretKey() {
      return required("CLERK_SECRET_KEY");
    },
  },
  dashboardOrigin: process.env.DASHBOARD_ORIGIN ?? "http://localhost:3001",
  // Stage 5: documents (menus, catalogs, price lists). The backend's own
  // public URL, needed to build a link Meta's servers can fetch a document
  // from when the bot sends one (routes/files.ts, lib/documentTools.ts) —
  // not derivable from the request itself since that link is generated
  // ahead of time, outside any HTTP request context.
  backendPublicUrl: process.env.BACKEND_PUBLIC_URL ?? `http://localhost:${Number(process.env.PORT ?? 3000)}`,
  // Stage 5: booking. Google OAuth (per-tenant "connect your calendar" flow,
  // routes/googleAuth.ts) + the key used to encrypt stored refresh tokens
  // (lib/crypto.ts) — a refresh token is a long-lived credential to a real
  // client's calendar, never stored in plaintext.
  google: {
    get clientId() {
      return required("GOOGLE_CLIENT_ID");
    },
    get clientSecret() {
      return required("GOOGLE_CLIENT_SECRET");
    },
    get redirectUri() {
      return required("GOOGLE_REDIRECT_URI");
    },
  },
  get tokenEncryptionKey() {
    return required("TOKEN_ENCRYPTION_KEY");
  },
  // Stage 2: where to send a WhatsApp ping when a conversation needs a human.
  // Optional — if unset, escalations are just logged, not sent anywhere.
  ownerNotifyNumber: process.env.OWNER_NOTIFY_NUMBER || undefined,
  // How long to wait after the last inbound message before replying, so a
  // burst of separate messages ("hey" / "I wanted to ask" / "about pricing")
  // gets answered as one coherent turn instead of three disjointed ones.
  messageDebounceMs: Number(process.env.MESSAGE_DEBOUNCE_MS ?? 7000),
  // Guards against reply loops/spam bursts (a "get your number banned" class
  // of bug) regardless of cause — max inbound messages per contact per window.
  rateLimit: {
    windowSeconds: Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 60),
    maxMessages: Number(process.env.RATE_LIMIT_MAX_MESSAGES ?? 10),
  },
};
