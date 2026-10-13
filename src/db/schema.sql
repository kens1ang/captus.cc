-- Stage 3 schema: shared schema, tenant_id + RLS on every tenant-scoped table
-- (per the architecture doc's §3 multi-tenancy model). RLS enable/force/policy
-- statements live in migrate.ts, run AFTER the one-time backfill of
-- pre-Stage-3 rows — see migrate.ts for why.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL,
  business_description text NOT NULL DEFAULT '',
  whatsapp_phone_number_id text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Stage 4: dashboard users. Not tenant-scoped in the RLS sense (there's no
-- tenant_id column to isolate FROM — a user's tenant_id IS how we find their
-- tenant in the first place, so this table is looked up via the raw pool,
-- like `tenants`, never through withTenant()).
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  clerk_user_id text UNIQUE NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'owner',
  -- Platform admin (you) vs a client's own dashboard user. tenant_id above is
  -- still that admin's own "home" tenant (Captus) — is_admin just additionally
  -- unlocks the cross-tenant /api/admin/* routes; it doesn't replace tenant_id.
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  wa_number text NOT NULL,
  -- 'bot': AI auto-replies (default). 'needs_human': escalated, bot still
  -- silent until a human sends a manual reply. 'human_active': a human has
  -- taken over — the worker checks this and skips the LLM/auto-reply
  -- entirely (architecture doc §5.6). Resumed back to 'bot' from the dashboard.
  status text NOT NULL DEFAULT 'bot' CHECK (status IN ('bot', 'needs_human', 'human_active')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'bot';
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_status_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_status_check CHECK (status IN ('bot', 'needs_human', 'human_active'));
-- Long-term memory of this customer, distilled from messages that have
-- scrolled out of the reply agent's recent-message window. Without this the
-- bot's memory was hard-capped at the last HISTORY_LIMIT messages — every
-- conversation older than that was durably stored but effectively invisible
-- to the model. See lib/conversationMemory.ts.
-- summary_through_message_at is the watermark: the created_at of the newest
-- message already folded into `summary`, so we never re-summarize the same
-- messages twice.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS summary_through_message_at timestamptz;
-- Pre-Stage-3, wa_number alone was globally unique; now the same customer
-- number can have separate conversations with separate tenants.
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_wa_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_tenant_wa_number_uidx ON conversations (tenant_id, wa_number);
-- Covers the dashboard's conversation list (RLS-filtered by tenant_id,
-- ordered by last_message_at DESC) — without this it's a sequential scan
-- once conversation volume grows past a handful of rows.
CREATE INDEX IF NOT EXISTS conversations_tenant_last_message_idx ON conversations (tenant_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  content text NOT NULL,
  -- WhatsApp message id, set for inbound messages only. Lets a BullMQ retry
  -- re-run the whole job safely (ON CONFLICT DO NOTHING) instead of writing
  -- a duplicate row each attempt.
  wa_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS wa_message_id text;
-- Architecture doc §4: audit trail for whatever the LLM decided to invoke and
-- with what arguments/results, on the bot's own "out" message row. This is
-- what you check first when a customer disputes "the bot booked me for the
-- wrong time" — not optional logging, the actual record of what happened.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tool_calls jsonb;

CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages (conversation_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS messages_wa_message_id_uidx
  ON messages (wa_message_id) WHERE wa_message_id IS NOT NULL;

-- gemini-embedding-001 pinned to 768 dims (see gemini.ts) to match this column.
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  content text NOT NULL,
  embedding vector(768) NOT NULL,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);

-- Stage 5: booking, per architecture doc §5.2 (Google Calendar as the
-- source-of-truth for availability, not a from-scratch calendar).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Singapore';
-- Set once per tenant when onboarding them — needed to create/manage THEIR
-- WhatsApp message templates (booking reminders, future follow-ups), since
-- templates are scoped to a WhatsApp Business Account, not a phone number,
-- and every real client has their own separate WABA (not Captus's).
-- Nullable: not needed for anything that doesn't send templates.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_business_account_id text;

-- What a tenant can be booked for. A booking always references one of these
-- (for its duration) — no freehand duration, same "never let the model
-- invent it" principle as prices in §5.3 of the architecture doc.
CREATE TABLE IF NOT EXISTS services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  name text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE services ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);

-- Weekly recurring open hours. One row per open interval; a weekday with no
-- row is closed. Multiple rows per day supports split hours (e.g. a lunch
-- break). Google freebusy alone can't tell us this — it only knows what's
-- already on the calendar, not when the business is even open.
CREATE TABLE IF NOT EXISTS business_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday
  start_time time NOT NULL,
  end_time time NOT NULL,
  CHECK (end_time > start_time)
);
ALTER TABLE business_hours ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS business_hours_tenant_idx ON business_hours (tenant_id);

-- One Google Calendar connection per tenant. refresh_token_encrypted is a
-- long-lived credential to the tenant's real calendar — encrypted at rest via
-- lib/crypto.ts, and RLS'd like everything else tenant-scoped (defense in
-- depth: this is more sensitive than an FAQ chunk, not less).
CREATE TABLE IF NOT EXISTS google_calendar_connections (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  calendar_id text NOT NULL DEFAULT 'primary',
  refresh_token_encrypted text NOT NULL,
  connected_email text,
  connected_at timestamptz NOT NULL DEFAULT now()
);

-- Local cache of what we've booked — Google Calendar is still the
-- source-of-truth an owner's staff actually look at, but a local row is what
-- the dashboard lists/manages without round-tripping Google on every read,
-- and it's a fast local double-booking guard alongside the live freebusy
-- check (lib/availability.ts checks both).
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  conversation_id uuid REFERENCES conversations(id),
  service_id uuid REFERENCES services(id),
  contact_wa_number text NOT NULL,
  contact_name text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  google_event_id text,
  -- Follow-up engine (mvp-plan.md's next stage after this one) will scan for
  -- upcoming bookings with reminder_sent_at IS NULL — added now so that
  -- doesn't need a later migration.
  reminder_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS bookings_tenant_starts_idx ON bookings (tenant_id, starts_at);

-- Files a tenant wants the bot able to send on request (menus, catalogs,
-- price lists — PDF, images, spreadsheets, anything WhatsApp documents
-- support). Stored as bytea directly in Postgres rather than a separate
-- object store — plenty fine at SME scale (a handful of files, each
-- typically under a few MB), same "don't add infra you don't need yet"
-- call as pgvector's brute-force search. Served publicly (routes/files.ts,
-- unauthenticated — Meta's servers fetch it, not a logged-in dashboard user)
-- via /files/:tenantId/:documentId, which is why RLS here matters just as
-- much as anywhere else: the tenant_id in that URL is what scopes the query.
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  name text NOT NULL, -- short label the model picks from, e.g. "Menu", "Price List"
  description text,
  filename text NOT NULL, -- original filename incl. extension, sent as WhatsApp's document filename
  mime_type text NOT NULL,
  file_data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS documents_tenant_idx ON documents (tenant_id);

-- Structured business info the owner fills in on the dashboard's Knowledge
-- pages, one row per section (lib/businessInfo.ts owns the section list and
-- each one's shape). Two kinds of section: "profile"-style ones (about,
-- location/contact, assistant style) go into every system prompt verbatim —
-- small, and asked about constantly — while "catalog"-style ones (products,
-- policies, FAQs) are rendered into knowledge_chunks under the source
-- `section:<key>` and retrieved via RAG. Saving a section replaces its own
-- chunks wholesale, so edits never leave stale duplicates behind.
CREATE TABLE IF NOT EXISTS business_info (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  section text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, section)
);
CREATE INDEX IF NOT EXISTS knowledge_chunks_tenant_source_idx ON knowledge_chunks (tenant_id, source);
