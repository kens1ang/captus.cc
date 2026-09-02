import type { PoolClient } from "pg";

// Every function here takes a `client` from db/tenantContext.ts's withTenant()
// — the SELECTs deliberately don't filter by tenant_id themselves; Postgres
// RLS does that via app.tenant_id, which is the actual point of Stage 3.

export async function getOrCreateConversation(client: PoolClient, tenantId: string, waNumber: string): Promise<string> {
  const existing = await client.query<{ id: string }>(`SELECT id FROM conversations WHERE wa_number = $1`, [
    waNumber,
  ]);
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO conversations (tenant_id, wa_number) VALUES ($1, $2) RETURNING id`,
    [tenantId, waNumber],
  );
  return inserted.rows[0].id;
}

export interface StoredMessage {
  direction: "in" | "out";
  content: string;
}

/** Returns the last `limit` messages, oldest first (ready to feed straight into the LLM). */
export async function getRecentMessages(client: PoolClient, conversationId: string, limit: number): Promise<StoredMessage[]> {
  const result = await client.query<StoredMessage>(
    `SELECT direction, content FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [conversationId, limit],
  );
  return result.rows.reverse();
}

/**
 * Records a message. When `waMessageId` is given (inbound messages), the
 * insert is idempotent — a BullMQ retry re-running this with the same id is
 * a no-op instead of a duplicate row. Returns whether a row was actually
 * inserted, so callers can skip further side effects (buffering, sending)
 * on a detected duplicate.
 */
export async function insertMessage(
  client: PoolClient,
  tenantId: string,
  conversationId: string,
  direction: "in" | "out",
  content: string,
  waMessageId?: string,
): Promise<{ inserted: boolean }> {
  if (waMessageId) {
    const result = await client.query(
      `INSERT INTO messages (tenant_id, conversation_id, direction, content, wa_message_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING`,
      [tenantId, conversationId, direction, content, waMessageId],
    );
    return { inserted: (result.rowCount ?? 0) > 0 };
  }
  await client.query(
    `INSERT INTO messages (tenant_id, conversation_id, direction, content) VALUES ($1, $2, $3, $4)`,
    [tenantId, conversationId, direction, content],
  );
  return { inserted: true };
}

export async function touchConversation(client: PoolClient, conversationId: string): Promise<void> {
  await client.query(`UPDATE conversations SET last_message_at = now() WHERE id = $1`, [conversationId]);
}

export type ConversationStatus = "bot" | "needs_human" | "human_active";

export interface ConversationSummary {
  id: string;
  waNumber: string;
  status: ConversationStatus;
  lastMessageAt: string;
}

/** Dashboard's conversation list — most recently active first. */
export async function listConversations(client: PoolClient, limit = 100): Promise<ConversationSummary[]> {
  const result = await client.query<{ id: string; wa_number: string; status: ConversationStatus; last_message_at: string }>(
    `SELECT id, wa_number, status, last_message_at FROM conversations ORDER BY last_message_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows.map((r) => ({
    id: r.id,
    waNumber: r.wa_number,
    status: r.status,
    lastMessageAt: r.last_message_at,
  }));
}

export interface ConversationDetail {
  id: string;
  waNumber: string;
  status: ConversationStatus;
}

export async function getConversation(client: PoolClient, conversationId: string): Promise<ConversationDetail | null> {
  const result = await client.query<{ id: string; wa_number: string; status: ConversationStatus }>(
    `SELECT id, wa_number, status FROM conversations WHERE id = $1`,
    [conversationId],
  );
  const row = result.rows[0];
  return row ? { id: row.id, waNumber: row.wa_number, status: row.status } : null;
}

/**
 * Stage 4 human takeover (architecture doc §5.6): the worker checks this
 * before auto-replying. 'needs_human' is set on escalation; 'human_active'
 * when the owner sends a manual reply from the dashboard; 'bot' resumes
 * AI auto-replies.
 */
export async function setConversationStatus(
  client: PoolClient,
  conversationId: string,
  status: ConversationStatus,
): Promise<void> {
  await client.query(`UPDATE conversations SET status = $1 WHERE id = $2`, [status, conversationId]);
}

export interface FullMessage {
  id: string;
  direction: "in" | "out";
  content: string;
  createdAt: string;
}

/** Dashboard's full thread view — unlike getRecentMessages, no limit and includes id/timestamp. */
export async function getAllMessages(client: PoolClient, conversationId: string): Promise<FullMessage[]> {
  const result = await client.query<{ id: string; direction: "in" | "out"; content: string; created_at: string }>(
    `SELECT id, direction, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId],
  );
  return result.rows.map((r) => ({ id: r.id, direction: r.direction, content: r.content, createdAt: r.created_at }));
}
