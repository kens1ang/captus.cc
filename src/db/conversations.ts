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
 * What the reply agent sees verbatim: the last `minRecent` messages, PLUS any
 * older ones the long-term summary hasn't absorbed yet. The summary catches
 * up in batches (lib/conversationMemory.ts), so without the second part a
 * message could sit in neither the window nor the summary — the e2e harness
 * caught the assistant recommending a dish with peanuts to a customer whose
 * "I'm severely allergic to peanuts" had fallen into exactly that gap.
 * `cap` bounds it if summarizing keeps failing on a very long chat.
 */
export async function getReplyHistory(
  client: PoolClient,
  conversationId: string,
  minRecent: number,
  summaryThroughMessageAt: string | Date | null,
  cap = 60,
): Promise<StoredMessage[]> {
  const result = await client.query<StoredMessage>(
    `SELECT direction, content FROM (
       SELECT direction, content, created_at, row_number() OVER (ORDER BY created_at DESC) AS rn
       FROM messages WHERE conversation_id = $1
     ) m
     WHERE rn <= $2 OR (rn <= $4 AND created_at > COALESCE($3::timestamptz, '-infinity'))
     ORDER BY created_at`,
    [conversationId, minRecent, summaryThroughMessageAt, cap],
  );
  return result.rows;
}

export interface ConversationMemory {
  summary: string | null;
  /** created_at of the newest message already folded into `summary`, or null if never summarized. */
  summaryThroughMessageAt: string | null;
}

export async function getConversationMemory(client: PoolClient, conversationId: string): Promise<ConversationMemory> {
  const result = await client.query<{ summary: string | null; summary_through_message_at: string | null }>(
    `SELECT summary, summary_through_message_at FROM conversations WHERE id = $1`,
    [conversationId],
  );
  const row = result.rows[0];
  return { summary: row?.summary ?? null, summaryThroughMessageAt: row?.summary_through_message_at ?? null };
}

export interface SummarizableMessage extends StoredMessage {
  createdAt: string;
}

/**
 * Messages that have scrolled out of the reply agent's recent window
 * (`keepRecent`) and aren't in the summary yet — i.e. exactly the ones at
 * risk of being forgotten. Ordered oldest first.
 *
 * The OFFSET is applied to the already-watermark-filtered set, which is what
 * we want: whatever is still unsummarized, minus the newest `keepRecent` of
 * them (those are still passed to the model verbatim, so summarizing them
 * now would be premature).
 */
export async function getMessagesToSummarize(
  client: PoolClient,
  conversationId: string,
  since: string | null,
  keepRecent: number,
): Promise<SummarizableMessage[]> {
  const result = await client.query<{ direction: "in" | "out"; content: string; created_at: string }>(
    `SELECT direction, content, created_at FROM messages
     WHERE conversation_id = $1 AND ($2::timestamptz IS NULL OR created_at > $2)
     ORDER BY created_at DESC
     OFFSET $3`,
    [conversationId, since, keepRecent],
  );
  return result.rows.map((r) => ({ direction: r.direction, content: r.content, createdAt: r.created_at })).reverse();
}

export async function updateConversationSummary(
  client: PoolClient,
  conversationId: string,
  summary: string,
  throughMessageAt: string,
): Promise<void> {
  await client.query(`UPDATE conversations SET summary = $2, summary_through_message_at = $3 WHERE id = $1`, [
    conversationId,
    summary,
    throughMessageAt,
  ]);
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
  // Architecture doc §4 audit trail — what the LLM invoked and with what
  // args/results, set on the bot's own "out" message when tools were used.
  toolCalls?: unknown[],
): Promise<{ inserted: boolean }> {
  const toolCallsJson = toolCalls && toolCalls.length > 0 ? JSON.stringify(toolCalls) : null;
  if (waMessageId) {
    const result = await client.query(
      `INSERT INTO messages (tenant_id, conversation_id, direction, content, wa_message_id, tool_calls)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING`,
      [tenantId, conversationId, direction, content, waMessageId, toolCallsJson],
    );
    return { inserted: (result.rowCount ?? 0) > 0 };
  }
  await client.query(
    `INSERT INTO messages (tenant_id, conversation_id, direction, content, tool_calls) VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, conversationId, direction, content, toolCallsJson],
  );
  return { inserted: true };
}

export async function touchConversation(client: PoolClient, conversationId: string): Promise<void> {
  await client.query(`UPDATE conversations SET last_message_at = now() WHERE id = $1`, [conversationId]);
}

export type ConversationStatus = "bot" | "flagged" | "needs_human" | "human_active";

export interface ConversationSummary {
  id: string;
  waNumber: string;
  status: ConversationStatus;
  lastMessageAt: string;
  /** Newest message in the thread (either direction) — the inbox list's preview line. */
  lastMessage: string | null;
  lastMessageDirection: "in" | "out" | null;
}

/** Dashboard's conversation list — most recently active first. */
export async function listConversations(client: PoolClient, limit = 100): Promise<ConversationSummary[]> {
  const result = await client.query<{
    id: string;
    wa_number: string;
    status: ConversationStatus;
    last_message_at: string;
    last_message: string | null;
    last_direction: "in" | "out" | null;
  }>(
    // LATERAL + LIMIT 1 rides messages_conversation_created_idx — one index
    // probe per conversation, not a scan of every message.
    `SELECT c.id, c.wa_number, c.status, c.last_message_at, m.content AS last_message, m.direction AS last_direction
     FROM conversations c
     LEFT JOIN LATERAL (
       SELECT content, direction FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
     ) m ON true
     ORDER BY c.last_message_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows.map((r) => ({
    id: r.id,
    waNumber: r.wa_number,
    status: r.status,
    lastMessageAt: r.last_message_at,
    lastMessage: r.last_message,
    lastMessageDirection: r.last_direction,
  }));
}

export interface ConversationDetail {
  id: string;
  waNumber: string;
  status: ConversationStatus;
  /** What the bot remembers about this customer long-term — shown in the dashboard so an owner can see (and sanity-check) what's being retained. */
  summary: string | null;
}

export async function getConversation(client: PoolClient, conversationId: string): Promise<ConversationDetail | null> {
  const result = await client.query<{ id: string; wa_number: string; status: ConversationStatus; summary: string | null }>(
    `SELECT id, wa_number, status, summary FROM conversations WHERE id = $1`,
    [conversationId],
  );
  const row = result.rows[0];
  return row ? { id: row.id, waNumber: row.wa_number, status: row.status, summary: row.summary } : null;
}

/**
 * Stage 4 human takeover (architecture doc §5.6): the worker checks this
 * before auto-replying. 'flagged' = the assistant couldn't answer something
 * and told the owner, but keeps replying; 'needs_human' = handed over
 * (complaint, asked for a person) and the assistant is paused; 'human_active'
 * when the owner sends a manual reply from the dashboard; 'bot' resumes
 * AI auto-replies (and clears a flag).
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
