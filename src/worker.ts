import { Worker } from "bullmq";
import {
  connection,
  INBOUND_MESSAGE_QUEUE,
  REPLY_DEBOUNCE_QUEUE,
  replyDebounceQueue,
  type InboundMessageJob,
  type ReplyDebounceJob,
} from "./lib/queue.js";
import { sendTextMessage, sendTypingIndicator, downloadMedia } from "./lib/whatsapp.js";
import { generateReply, embedText, transcribeAudio, type ChatTurn } from "./lib/gemini.js";
import { buildSystemPrompt } from "./lib/systemPrompt.js";
import {
  getOrCreateConversation,
  getRecentMessages,
  insertMessage,
  touchConversation,
  getConversation,
  setConversationStatus,
} from "./db/conversations.js";
import { searchKnowledge } from "./db/knowledge.js";
import { withTenant } from "./db/tenantContext.js";
import { getTenantById } from "./db/tenants.js";
import { notifyEscalation } from "./lib/escalation.js";
import { config } from "./lib/config.js";

const HISTORY_LIMIT = 10;
const RAG_TOP_K = 4;

function bufferKey(from: string): string {
  return `msgbuffer:${from}`;
}

// BullMQ rejects a purely-numeric jobId (reserved for its own auto-increment
// ids) and rejects ":" (used internally as a Redis key delimiter) — phone
// numbers are all digits, so this needs a non-numeric, colon-free prefix.
// Stage 3 note: this is still keyed by `from` alone (not tenant+from) — fine
// while the same customer number won't be messaging two tenants at once in
// practice, but worth revisiting if that changes.
function debounceJobId(from: string): string {
  return `wa_${from}`;
}

interface BufferedMessage {
  text: string;
  messageId: string;
}

/**
 * Records a fixed apology reply + escalates to a human, without ever
 * touching the LLM — used both for media types we don't handle at all
 * (images/docs/stickers) and for a voice note we couldn't get usable text
 * out of (silent, unintelligible, transcription API failure). Deliberately
 * rule-based: whatever went wrong, the customer still gets a reply instead
 * of the job just dying after retries, and a human finds out either way.
 */
async function acknowledgeAndEscalate(
  tenantId: string,
  from: string,
  messageId: string,
  waPhoneNumberId: string,
  inboundLogText: string,
  ack: string,
  escalateContext: string,
  escalateReason: string,
): Promise<void> {
  const inserted = await withTenant(tenantId, async (client) => {
    const conversationId = await getOrCreateConversation(client, tenantId, from);
    const { inserted } = await insertMessage(client, tenantId, conversationId, "in", inboundLogText, messageId);
    if (!inserted) return false;
    await insertMessage(client, tenantId, conversationId, "out", ack);
    await touchConversation(client, conversationId);
    return true;
  });
  if (!inserted) {
    console.log(`[worker] duplicate job for message ${messageId} — already acknowledged, skipping`);
    return;
  }
  await sendTextMessage(waPhoneNumberId, from, ack);
  await notifyEscalation(waPhoneNumberId, from, escalateContext, escalateReason);
}

/** Per-contact rate limit — a generic guard against reply loops/spam bursts, regardless of cause. */
async function isRateLimited(from: string): Promise<boolean> {
  const key = `ratelimit:${from}`;
  const count = await connection.incr(key);
  if (count === 1) {
    await connection.expire(key, config.rateLimit.windowSeconds);
  }
  return count > config.rateLimit.maxMessages;
}

/** Resets the debounce timer for a contact: only the flush job that survives without being reset actually replies. */
async function scheduleDebouncedReply(tenantId: string, from: string, waPhoneNumberId: string): Promise<void> {
  const jobId = debounceJobId(from);
  const existing = await replyDebounceQueue.getJob(jobId);
  if (existing) {
    // Must remove in every non-active state, not just "delayed"/"waiting" —
    // a fixed jobId left in a terminal "completed" or "failed" state (from
    // this contact's *previous* reply) can never be reused by a later add(),
    // which was silently turning every contact's debounce into a one-shot:
    // the first reply worked, every message after it buffered forever with
    // no flush ever scheduled.
    const state = await existing.getState();
    if (state !== "active") {
      await existing.remove();
    }
  }
  try {
    await replyDebounceQueue.add(
      "flush",
      { tenantId, from, waPhoneNumberId },
      { jobId, delay: config.messageDebounceMs },
    );
  } catch (err) {
    // Rare race: a flush for this contact is actively processing right now,
    // so its jobId can't be reused yet. Fall back to a one-off id so this
    // message still gets scheduled instead of being silently stuck.
    console.warn(`[worker] debounce jobId collision for ${from}, using fallback id:`, err);
    await replyDebounceQueue.add(
      "flush",
      { tenantId, from, waPhoneNumberId },
      { jobId: `${jobId}_${Date.now()}`, delay: config.messageDebounceMs },
    );
  }
}

// --- Worker 1: records every inbound message immediately (durable history,
// regardless of reply timing), then buffers it and (re)schedules the
// debounced reply. ---
const inboundWorker = new Worker<InboundMessageJob>(
  INBOUND_MESSAGE_QUEUE,
  async (job) => {
    const { tenantId, from, messageId, waPhoneNumberId, kind } = job.data;

    if (await isRateLimited(from)) {
      console.warn(`[worker] rate limit exceeded for ${from} (msg ${messageId}) — dropping to avoid a reply loop/spam burst`);
      return;
    }

    if (kind === "unsupported") {
      console.log(`[worker] unsupported message type from ${from} (msg ${messageId}) — acknowledging, not dropping`);
      await acknowledgeAndEscalate(
        tenantId,
        from,
        messageId,
        waPhoneNumberId,
        "[unsupported media message]",
        "Thanks for sending that — right now I can only read text and voice messages. Could you describe what you need in a text message? I've flagged this for the team to take a look too.",
        "[customer sent a photo/file/other unsupported message type]",
        "unsupported media — needs manual review",
      );
      return;
    }

    let text: string;
    if (kind === "audio") {
      if (!job.data.mediaId || !job.data.mimeType) {
        throw new Error("audio job missing mediaId/mimeType");
      }
      console.log(`[worker] transcribing voice note from ${from} (msg ${messageId})`);
      try {
        const media = await downloadMedia(job.data.mediaId);
        text = await transcribeAudio(media.data, media.mimeType);
        console.log(`[worker] transcript: "${text}"`);
      } catch (err) {
        // Silent/empty audio, or the transcription call itself failing —
        // previously this threw uncaught, BullMQ retried 3x, then the job
        // just died with the customer never hearing back at all. Same
        // rule-based fallback as the "unsupported" branch instead: the
        // customer always gets *something*, and a human gets pinged.
        console.warn(`[worker] voice note transcription failed for ${from} (msg ${messageId}):`, err);
        await acknowledgeAndEscalate(
          tenantId,
          from,
          messageId,
          waPhoneNumberId,
          "[voice note — transcription failed]",
          "Sorry, I couldn't quite make out that voice note (it may have been unclear or silent) — could you try again or send it as a text message? I've flagged this for the team too.",
          "[customer sent a voice note that failed to transcribe]",
          "voice note transcription failed — needs manual review",
        );
        return;
      }
    } else {
      text = job.data.text ?? "";
    }

    console.log(`[worker] received "${text}" from ${from} (msg ${messageId})`);

    const inserted = await withTenant(tenantId, async (client) => {
      const conversationId = await getOrCreateConversation(client, tenantId, from);
      const result = await insertMessage(client, tenantId, conversationId, "in", text, messageId);
      return result.inserted;
    });
    if (!inserted) {
      console.log(`[worker] duplicate job for message ${messageId} — already recorded, skipping buffer/schedule`);
      return;
    }

    const buffered: BufferedMessage = { text, messageId };
    await connection.rpush(bufferKey(from), JSON.stringify(buffered));

    await scheduleDebouncedReply(tenantId, from, waPhoneNumberId);
  },
  { connection },
);

// --- Worker 2: fires once the debounce window passes with no new message —
// generates and sends ONE reply covering everything buffered since the last reply. ---
const replyWorker = new Worker<ReplyDebounceJob>(
  REPLY_DEBOUNCE_QUEUE,
  async (job) => {
    const { tenantId, from, waPhoneNumberId } = job.data;

    // Read (don't clear) the buffer — cleared only after a successful send,
    // so a retry after a transient failure (e.g. Gemini 503) re-reads the
    // same buffered messages instead of finding an empty list and silently
    // dropping the reply.
    const rawBuffered = await connection.lrange(bufferKey(from), 0, -1);
    if (rawBuffered.length === 0) return; // nothing buffered (shouldn't normally happen)

    const buffered: BufferedMessage[] = rawBuffered.map((raw) => JSON.parse(raw));
    const lastMessageId = buffered[buffered.length - 1].messageId;
    const combinedText = buffered.map((b) => b.text).join("\n");
    console.log(`[worker] flushing ${buffered.length} buffered message(s) from ${from}: "${combinedText}"`);

    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found (deleted after the message arrived?)`);
    }

    // DB-only: fetch conversation state + history in one short transaction.
    // Deliberately NOT wrapping the Gemini calls below in this (or any)
    // transaction — embedText/generateReply are network round-trips that can
    // take seconds, and holding a pooled Postgres connection idle-in-transaction
    // for that long is how a burst of concurrent replies exhausts the pool and
    // wedges unrelated queries (webhook inserts, dashboard reads) behind LLM
    // latency. Each DB step below gets its own short-lived withTenant() instead.
    const convoState = await withTenant(tenantId, async (client) => {
      const conversationId = await getOrCreateConversation(client, tenantId, from);

      // Stage 4 human takeover (architecture doc §5.6): once a human has
      // stepped in (or it's flagged as needing one), the bot goes silent —
      // no auto-reply — until the dashboard resumes it back to 'bot'.
      const conversation = await getConversation(client, conversationId);
      if (conversation && conversation.status !== "bot") {
        return { skip: true as const, conversationId };
      }

      // History already contains each buffered message as its own turn (inserted by worker 1),
      // so the model sees them as sequential user turns rather than one flattened blob.
      const history = await getRecentMessages(client, conversationId, HISTORY_LIMIT);
      return { skip: false as const, conversationId, history };
    });

    if (convoState.skip) {
      console.log(`[worker] conversation with ${from} is human-handled — skipping auto-reply`);
      await connection.del(bufferKey(from)); // still clear so it doesn't pile up; the human sees raw messages in the dashboard
      return;
    }

    const { conversationId, history } = convoState;

    // Show typing as soon as we know we're actually going to reply (not
    // right before send) — that's the whole point of it masking LLM latency.
    await sendTypingIndicator(waPhoneNumberId, lastMessageId);

    // Embed the combined buffered text (better intent signal than any single
    // fragment) for RAG lookup — no DB connection held during this network call.
    const queryEmbedding = await embedText(combinedText);
    const knowledge = await withTenant(tenantId, (client) => searchKnowledge(client, queryEmbedding, RAG_TOP_K));
    const systemPrompt = buildSystemPrompt(tenant.businessName, tenant.businessDescription, knowledge.map((k) => k.content));

    const chatHistory: ChatTurn[] = history.map((m) => ({
      role: m.direction === "in" ? "user" : "model",
      text: m.content,
    }));

    const result = await generateReply(systemPrompt, chatHistory);

    // Deliberately NOT persisted yet — see below. If sendTextMessage throws
    // (e.g. WhatsApp/Meta-side rejection), a message recorded here would
    // (a) show as "sent" in the dashboard when it never reached the
    // customer, and (b) poison the next retry's chatHistory above, which
    // would then end on a "model" turn instead of "user" — Gemini rejects
    // that outright, turning one WhatsApp-side failure into a second,
    // unrelated one that eats the rest of the retry budget.
    await sendTextMessage(waPhoneNumberId, from, result.reply);
    await connection.del(bufferKey(from)); // only clear once the reply has actually gone out

    // Only record the reply (and any state it implies) once it's actually
    // out the door — see the comment above.
    await withTenant(tenantId, async (client) => {
      await insertMessage(client, tenantId, conversationId, "out", result.reply);
      await touchConversation(client, conversationId);
      if (result.escalate) {
        await setConversationStatus(client, conversationId, "needs_human");
      }
    });

    if (result.escalate) {
      console.log(`[worker] escalating conversation with ${from}: ${result.escalateReason ?? "unspecified"}`);
      await notifyEscalation(waPhoneNumberId, from, combinedText, result.escalateReason);
    }
  },
  { connection },
);

for (const w of [inboundWorker, replyWorker]) {
  w.on("completed", (job) => console.log(`[worker] job ${job.id} completed`));
  w.on("failed", (job, err) => console.error(`[worker] job ${job?.id} failed:`, err));
}

console.log("Worker started, waiting for inbound messages...");
