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
-- Pre-Stage-3, wa_number alone was globally unique; now the same customer
-- number can have separate conversations with separate tenants.
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_wa_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_tenant_wa_number_uidx ON conversations (tenant_id, wa_number);

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
