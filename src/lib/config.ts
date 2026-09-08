import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
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
  },
  gemini: {
    get apiKey() {
      return required("GEMINI_API_KEY");
    },
    // Overridable in case a model name gets deprecated/renamed.
    model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001",
    // Voice notes: a lite text model may not support audio input, so this is
    // independently overridable from the main chat model.
    transcriptionModel: process.env.GEMINI_TRANSCRIBE_MODEL ?? "gemini-3.5-flash-lite",
  },
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
