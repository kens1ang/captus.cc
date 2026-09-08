import { withTenant } from "../db/tenantContext.js";
import { getConversationMemory, getMessagesToSummarize, updateConversationSummary } from "../db/conversations.js";
import { summarizeConversation } from "./gemini.js";

/**
 * How many of the most recent messages stay out of the summary — they're
 * already passed to the model verbatim each turn (worker.ts's HISTORY_LIMIT),
 * so summarizing them too would just duplicate context at extra cost.
 * Must stay in sync with HISTORY_LIMIT.
 */
export const MEMORY_KEEP_RECENT = 20;

/**
 * Only summarize once this many messages have scrolled past the window
 * unsummarized. Summarizing on every message would mean an extra LLM call
 * per reply for a conversation of any length; batching amortizes that down
 * to roughly one call per SUMMARY_BATCH_SIZE messages. The tradeoff is a
 * brief window where the oldest few out-of-window messages are in neither
 * the raw history nor the summary yet.
 */
const SUMMARY_BATCH_SIZE = 6;

/**
 * Folds any messages that have scrolled out of the reply window into the
 * conversation's running summary. Call AFTER a reply has been sent — never
 * before, and never anywhere the reply path depends on it succeeding.
 */
export async function maybeUpdateConversationSummary(tenantId: string, conversationId: string): Promise<void> {
  const { summary, summaryThroughMessageAt } = await withTenant(tenantId, (client) =>
    getConversationMemory(client, conversationId),
  );

  const pending = await withTenant(tenantId, (client) =>
    getMessagesToSummarize(client, conversationId, summaryThroughMessageAt, MEMORY_KEEP_RECENT),
  );
  if (pending.length < SUMMARY_BATCH_SIZE) return;

  const transcript = pending.map((m) => `${m.direction === "in" ? "Customer" : "Assistant"}: ${m.content}`).join("\n");
  // Network call deliberately outside any withTenant transaction — same
  // reason as the reply path: never hold a pooled Postgres connection open
  // across an LLM round-trip.
  const updated = await summarizeConversation(summary, transcript);

  const throughMessageAt = pending[pending.length - 1].createdAt;
  await withTenant(tenantId, (client) => updateConversationSummary(client, conversationId, updated, throughMessageAt));
  console.log(`[memory] updated summary for conversation ${conversationId} (folded in ${pending.length} message(s))`);
}
