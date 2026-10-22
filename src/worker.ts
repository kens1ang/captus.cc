import { Worker, type Job } from "bullmq";
import { DateTime } from "luxon";
import {
  connection,
  INBOUND_MESSAGE_QUEUE,
  REPLY_DEBOUNCE_QUEUE,
  replyDebounceQueue,
  MESSAGE_STATUS_QUEUE,
  REMINDER_QUEUE,
  BUSINESS_IMPORT_QUEUE,
  type InboundMessageJob,
  type ReplyDebounceJob,
  type MessageStatusJob,
  type ReminderJob,
  type BusinessImportJob,
} from "./lib/queue.js";
import { runImport } from "./lib/businessImport.js";
import { sendTextMessage, sendTypingIndicator, sendTemplateMessage, downloadMedia } from "./lib/whatsapp.js";
import {
  runReplyTurn,
  transcribeAudio,
  describeMedia,
  isAnalyzableMedia,
  MAX_ANALYZABLE_MEDIA_BYTES,
  ReplyTurnFailedError,
  type ChatTurn,
  type LoggedToolCall,
} from "./lib/gemini.js";
import { AllModelsFailedError, GeminiError, isTransientFailure } from "./lib/llmFallback.js";
import { alertOperator } from "./lib/opsAlert.js";
import { buildBookingTools, executeBookingTool, BOOKING_TOOL_NAMES, BOOKING_CHANGE_TOOL_NAMES } from "./lib/bookingTools.js";
import { buildDocumentTools, executeDocumentTool, DOCUMENT_TOOL_NAMES } from "./lib/documentTools.js";
import { REMINDER_TEMPLATE_NAME, REMINDER_TEMPLATE_LANGUAGE, reminderBodyParams, reminderPlainText, restoreReminders } from "./lib/bookingReminders.js";
import type { ToolCall } from "./lib/gemini.js";
import {
  getOrCreateConversation,
  getReplyHistory,
  insertMessage,
  touchConversation,
  getConversation,
  getConversationMemory,
  setConversationStatus,
  getLastReply,
  recordDeliveryStatus,
} from "./db/conversations.js";
import { maybeUpdateConversationSummary, MEMORY_KEEP_RECENT } from "./lib/conversationMemory.js";
import { loadBusinessContext, buildReplySystemPrompt } from "./lib/replyContext.js";
import { getBookingById, markReminderSent } from "./db/bookings.js";
import { withTenant } from "./db/tenantContext.js";
import { getTenantById, getTenantByPhoneNumberId } from "./db/tenants.js";
import { notifyEscalation } from "./lib/escalation.js";
import { config } from "./lib/config.js";

// Raw messages passed to the model verbatim each turn. Anything older than
// this is covered by the conversation summary instead (lib/conversationMemory.ts)
// — which is also why this can afford to be generous now: in-session
// coherence shouldn't depend on a summary of something said three minutes ago.
const HISTORY_LIMIT = MEMORY_KEEP_RECENT;
const INBOUND_CONCURRENCY = 10;
const REPLY_CONCURRENCY = 8;

// Everything per-conversation in Redis (buffer, debounce timer, reply lock,
// rate limit) is keyed by business + customer. Keyed by the customer's
// number alone, someone messaging two Captus businesses at once would have
// had both businesses' messages buffered together and answered as one.
function convKey(tenantId: string, from: string): string {
  return `${tenantId}_${from}`;
}

function bufferKey(tenantId: string, from: string): string {
  return `msgbuffer:${convKey(tenantId, from)}`;
}

// BullMQ rejects a purely-numeric jobId (reserved for its own auto-increment
// ids) and rejects ":" (used internally as a Redis key delimiter).
function debounceJobId(tenantId: string, from: string): string {
  return `wa_${convKey(tenantId, from)}`;
}

function rewriteKey(tenantId: string, from: string): string {
  return `replyrewrites:${convKey(tenantId, from)}`;
}

interface BufferedMessage {
  messageId: string;
  /** Empty while `pending`. */
  text: string;
  /** When we received it (ms). The cap on how long a reply waits counts from the oldest one. */
  at: number;
  /** When the customer sent it (ms, Meta's clock) — compared with when they read our last reply. */
  sentAt: number;
  /**
   * A voice note / photo / document still being transcribed or read. Holds
   * its place in the buffer (so it's answered in the order it was sent) and
   * holds the reply back until it's ready — otherwise a text sent right
   * after a voice note got answered first, and the voice note separately.
   */
  pending?: boolean;
}

// Media that's still "being read" after this long is assumed lost (its job
// died for good — the inbound job's whole retry runway is ~4 minutes): the
// reply stops waiting for it.
const PENDING_MAX_MS = 5 * 60_000;
// While waiting on media, re-check this often. Only a safety net: finishing
// the media schedules the reply itself.
const PENDING_RECHECK_MS = 30_000;

// Atomic find-by-messageId on the buffer list, since a reply finishing at
// the same moment may be removing other entries. ARGV: messageId, entry
// JSON, mode — "add" (append unless already there), "set" (replace, or
// append), "dropPending" (remove it, only if still a placeholder).
const PUT_BUFFERED = `
local items = redis.call("lrange", KEYS[1], 0, -1)
for i, raw in ipairs(items) do
  local ok, m = pcall(cjson.decode, raw)
  if ok and m.messageId == ARGV[1] then
    if ARGV[3] == "set" then
      redis.call("lset", KEYS[1], i - 1, ARGV[2])
    elseif ARGV[3] == "dropPending" and m.pending then
      redis.call("lrem", KEYS[1], 1, raw)
    end
    return 1
  end
end
if ARGV[3] ~= "dropPending" then redis.call("rpush", KEYS[1], ARGV[2]) end
return 0`;

async function putBuffered(tenantId: string, from: string, entry: BufferedMessage, mode: "add" | "set" | "dropPending"): Promise<void> {
  await connection.eval(PUT_BUFFERED, 1, bufferKey(tenantId, from), entry.messageId, JSON.stringify(entry), mode);
}

function bufferEntry(job: InboundMessageJob, text: string, pending?: boolean): BufferedMessage {
  const at = Date.parse(job.receivedAt);
  return { messageId: job.messageId, text, at, sentAt: job.sentAt ? Date.parse(job.sentAt) : at, ...(pending && { pending }) };
}

/**
 * A voice note / photo that won't be getting text after all (already
 * acknowledged with an apology, or a duplicate job): stop holding the reply
 * for it, and answer whatever else is waiting.
 */
async function dropPlaceholder(tenantId: string, from: string, waPhoneNumberId: string, job: InboundMessageJob): Promise<void> {
  await putBuffered(tenantId, from, bufferEntry(job, "", true), "dropPending");
  if ((await connection.llen(bufferKey(tenantId, from))) > 0) {
    await scheduleDebouncedReply(tenantId, from, waPhoneNumberId, "");
  }
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

// Sent when the assistant can't produce a reply at all (every AI model down,
// key revoked, a crash mid-turn). Fixed text, no AI involved — the one thing
// that must work when everything else is failing. Kept neutral and short so
// it reads fine whatever language the customer wrote in.
const HOLDING_REPLY = "Thanks for your message! 🙏 I'm having a little trouble replying right now — someone from our team will get back to you shortly.";

/**
 * The customer always hears back, the chat is flagged for a human in the
 * dashboard, and the business is pinged through the normal escalation
 * path. Any booking tool that ran before the failure is called out, since
 * the customer may not have been told it went through.
 */
async function sendHoldingReplyAndEscalate(input: {
  tenantId: string;
  from: string;
  waPhoneNumberId: string;
  conversationId: string;
  combinedText: string;
  toolCalls: LoggedToolCall[];
  handled: string[];
}): Promise<void> {
  const { tenantId, from, waPhoneNumberId, conversationId, combinedText, toolCalls, handled } = input;
  const sentId = await sendTextMessage(waPhoneNumberId, from, HOLDING_REPLY);
  await clearHandled(tenantId, from, handled);
  await withTenant(tenantId, async (client) => {
    await insertMessage(client, tenantId, conversationId, "out", HOLDING_REPLY, sentId, toolCalls.length ? toolCalls : undefined);
    await touchConversation(client, conversationId);
    await setConversationStatus(client, conversationId, "needs_human");
  });
  const actions = toolCalls.map((t) => t.name).join(", ");
  await notifyEscalation(
    waPhoneNumberId,
    from,
    combinedText,
    actions
      ? `assistant failed mid-reply after running: ${actions} — check Bookings and confirm with the customer`
      : "assistant couldn't reply (AI service problem) — please reply to the customer",
  );
}

/**
 * A voice note / photo / document whose analysis failed only because Gemini
 * was momentarily overloaded or rate-limited is worth retrying — the inbound
 * job has minutes of retries and nothing has been recorded yet, so it's
 * safe. Anything else (unreadable file, download failure, dead key) goes
 * straight to the apology + escalation, as does the last attempt.
 */
function shouldRetryMedia(err: unknown, job: { opts: { attempts?: number }; attemptsMade: number }): boolean {
  const aiHiccup = err instanceof AllModelsFailedError || err instanceof GeminiError;
  const attemptsLeft = (job.opts.attempts ?? 1) - job.attemptsMade - 1;
  if (aiHiccup && isTransientFailure(err) && attemptsLeft > 0) {
    console.warn(`[worker] media analysis hit a temporary AI failure — retrying (${attemptsLeft} left)`);
    return true;
  }
  return false;
}

/**
 * Removes exactly the buffered entries a reply just covered (by their raw
 * JSON), keeping anything that arrived while it was being written and any
 * voice note still being transcribed. (Deleting the whole buffer here is how
 * a message sent mid-reply used to vanish.)
 */
async function clearHandled(tenantId: string, from: string, handled: string[]): Promise<void> {
  if (handled.length === 0) return;
  const pipeline = connection.pipeline();
  for (const raw of handled) pipeline.lrem(bufferKey(tenantId, from), 1, raw);
  await pipeline.exec();
}

/** Whether anything is in the buffer besides `handled` — a message (or a voice note still being read) that arrived since. */
async function hasNewMessages(tenantId: string, from: string, handled: string[]): Promise<boolean> {
  const seen = new Set(handled);
  return (await connection.lrange(bufferKey(tenantId, from), 0, -1)).some((raw) => !seen.has(raw));
}

// One reply per customer at a time, across every job and retry. A message
// arriving mid-reply gets its own one-off flush job (scheduleDebouncedReply),
// which must wait for the reply in progress rather than answer in parallel.
const REPLY_LOCK_MS = 3 * 60_000; // longer than any reply can take (every model timing out in turn)
const REPLY_LOCK_RETRY_MS = 3000;
// How many times in a row a reply may be thrown away because the customer
// sent more while it was being written, before one is sent anyway — so
// someone sending a steady stream of messages still hears back.
const MAX_REWRITES = 2;

function isHumanHandled(status: string): boolean {
  return status === "needs_human" || status === "human_active";
}

// A customer message within this long of our last reply, sent before they
// read it, means the two crossed (see UNREAD_REPLY_NOTE). Wider than that,
// an unread reply is just an old one they never opened.
const CROSSED_WINDOW_MS = 5 * 60_000;
const UNREAD_REPLY_NOTE = `

About the customer's latest message(s): they sent them before they had seen your previous reply — the messages crossed, or they haven't opened yours yet. Answer what they wrote directly and completely, as if your previous reply might not have been read: don't refer back to it ("as I mentioned", "like I said above"), and if it already answered their question, give the answer again briefly instead of pointing to it.`;

async function withReplyLock(job: { data: ReplyDebounceJob; id?: string }, fn: () => Promise<void>): Promise<void> {
  const { tenantId, from } = job.data;
  const key = `replylock:${convKey(tenantId, from)}`;
  const token = `${job.id}:${Date.now()}`;
  if (!(await connection.set(key, token, "PX", REPLY_LOCK_MS, "NX"))) {
    await replyDebounceQueue.add("flush", job.data, { jobId: `${debounceJobId(tenantId, from)}_${Date.now()}`, delay: REPLY_LOCK_RETRY_MS });
    return;
  }
  try {
    await fn();
  } finally {
    // Release only our own lock (it may have expired and been taken over).
    await connection.eval(`if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`, 1, key, token);
  }
}

/** Per-contact rate limit — a generic guard against reply loops/spam bursts, regardless of cause. */
async function isRateLimited(tenantId: string, from: string): Promise<boolean> {
  const key = `ratelimit:${convKey(tenantId, from)}`;
  const count = await connection.incr(key);
  if (count === 1) {
    await connection.expire(key, config.rateLimit.windowSeconds);
  }
  return count > config.rateLimit.maxMessages;
}

/**
 * "hey" / "one more thing" / "also..." — a message that's announcing more to
 * come. Seen on a real phone: someone typing a three-part question at normal
 * speed got answered after the second part, because the 7s window ran out
 * while they were still typing the third. These get twice the wait.
 */
function looksLikeLeadIn(text: string): boolean {
  const t = text.trim();
  if (!t || t.includes("?") || t.split(/\s+/).length > 4) return false;
  return /^(hi|hii+|hey+|hello|helo|hai|yo|one more|also|and|so|wait|btw|actually|um+|uh+|ok so)\b/i.test(t) || /(:|\.\.\.|…)$/.test(t);
}

/**
 * Resets the debounce timer for a conversation: only the flush job that
 * survives without being reset actually replies. Never later than
 * messageMaxWaitMs after the oldest unanswered message, though — someone
 * typing a message every few seconds would otherwise reset it forever.
 */
async function scheduleDebouncedReply(tenantId: string, from: string, waPhoneNumberId: string, latestText: string): Promise<void> {
  const wait = looksLikeLeadIn(latestText) ? config.messageDebounceMs * 2 : config.messageDebounceMs;
  const oldest = await connection.lindex(bufferKey(tenantId, from), 0);
  const firstAt = oldest ? ((JSON.parse(oldest) as BufferedMessage).at ?? Date.now()) : Date.now();
  const delay = Math.max(0, Math.min(wait, firstAt + config.messageMaxWaitMs - Date.now()));
  await scheduleFlush(debounceJobId(tenantId, from), { tenantId, from, waPhoneNumberId }, delay);
}

/** (Re)schedules the flush job with this fixed id, replacing a pending one. */
async function scheduleFlush(jobId: string, data: ReplyDebounceJob, delay: number): Promise<void> {
  const existing = await replyDebounceQueue.getJob(jobId);
  if (existing) {
    // Must remove in every non-active state, not just "delayed"/"waiting" —
    // a fixed jobId left in a terminal "completed" or "failed" state (from
    // this contact's *previous* reply) can never be reused by a later add(),
    // which was silently turning every contact's debounce into a one-shot:
    // the first reply worked, every message after it buffered forever with
    // no flush ever scheduled.
    const state = await existing.getState();
    if (state === "active") {
      // A reply to this customer is being written right now. add() with the
      // same jobId would be silently ignored (BullMQ dedupes, it doesn't
      // throw), so this message would never get a reply of its own — and
      // used to be wiped from the buffer when that reply went out. Seen on
      // a real phone. Schedule a one-off flush instead; the reply in
      // progress notices the new message and leaves it to this one.
      await replyDebounceQueue.add("flush", data, { jobId: `${jobId}_${Date.now()}`, delay });
      return;
    }
    await existing.remove();
  }
  try {
    await replyDebounceQueue.add("flush", data, { jobId, delay });
  } catch (err) {
    // Rare race: became active between getState() and add().
    console.warn(`[worker] flush jobId collision for ${jobId}, using fallback id:`, err);
    await replyDebounceQueue.add("flush", data, { jobId: `${jobId}_${Date.now()}`, delay });
  }
}

// --- Worker 1: records every inbound message immediately (durable history,
// regardless of reply timing), then buffers it and (re)schedules the
// debounced reply. ---
const inboundWorker = new Worker<InboundMessageJob>(
  INBOUND_MESSAGE_QUEUE,
  async (job) => {
    const { from, messageId, waPhoneNumberId, kind } = job.data;

    // Stage 3: one webhook endpoint serves every tenant, routed by which
    // WhatsApp number the message arrived on.
    const tenant = await getTenantByPhoneNumberId(waPhoneNumberId);
    if (!tenant) {
      console.warn(`[worker] no tenant configured for WhatsApp number ${waPhoneNumberId} — dropping message ${messageId}`);
      return;
    }
    const tenantId = tenant.id;

    if (await isRateLimited(tenantId, from)) {
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
      await putBuffered(tenantId, from, bufferEntry(job.data, "", true), "add");
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
        if (shouldRetryMedia(err, job)) throw err;
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
        await dropPlaceholder(tenantId, from, waPhoneNumberId, job.data);
        return;
      }
    } else if (kind === "image" || kind === "document") {
      if (!job.data.mediaId || !job.data.mimeType) {
        throw new Error(`${kind} job missing mediaId/mimeType`);
      }
      const { mimeType, filename, caption } = job.data;
      const label = kind === "image" ? "photo" : `file${filename ? ` "${filename}"` : ""}`;

      // Formats Gemini can't read inline (xlsx, docx, archives...) still get
      // the acknowledge-and-escalate treatment — better an honest "I can't
      // open that" than a failed analysis mid-pipeline.
      if (!isAnalyzableMedia(mimeType)) {
        console.log(`[worker] ${kind} from ${from} has unreadable type ${mimeType} — acknowledging, not dropping`);
        await acknowledgeAndEscalate(
          tenantId,
          from,
          messageId,
          waPhoneNumberId,
          `[${label} — unreadable format: ${mimeType}]`,
          `Thanks for sending that${filename ? ` (${filename})` : ""} — I can't open that file type. Could you send it as a PDF or an image, or tell me what you need in a message? I've flagged this for the team too.`,
          `[customer sent a file the assistant can't read: ${mimeType}]`,
          "unreadable file format — needs manual review",
        );
        return;
      }

      await putBuffered(tenantId, from, bufferEntry(job.data, "", true), "add");
      console.log(`[worker] analyzing ${kind} from ${from} (msg ${messageId}, ${mimeType})`);
      try {
        const media = await downloadMedia(job.data.mediaId);
        if (media.data.byteLength > MAX_ANALYZABLE_MEDIA_BYTES) {
          throw new Error(`media too large to analyze inline (${media.data.byteLength} bytes)`);
        }
        const description = await describeMedia(media.data, media.mimeType, filename);
        // The caption is the customer's own words and usually carries the
        // actual question ("is this in stock?"), so it leads; the description
        // rides along as context. Stored as the message content, so history
        // and the dashboard both show something meaningful rather than
        // "[unsupported media]".
        text = caption?.trim()
          ? `${caption.trim()}\n[sent a ${label} — ${description}]`
          : `[sent a ${label} — ${description}]`;
        console.log(`[worker] ${kind} description: "${description}"`);
      } catch (err) {
        if (shouldRetryMedia(err, job)) throw err;
        console.warn(`[worker] ${kind} analysis failed for ${from} (msg ${messageId}):`, err);
        await acknowledgeAndEscalate(
          tenantId,
          from,
          messageId,
          waPhoneNumberId,
          `[${label} — could not be read]`,
          `Thanks for sending that — I had trouble opening it on my end. Could you try again, or tell me what you need in a message? I've flagged this for the team too.`,
          `[customer sent a ${label} that couldn't be analyzed]`,
          `${kind} analysis failed — needs manual review`,
        );
        await dropPlaceholder(tenantId, from, waPhoneNumberId, job.data);
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
      console.log(`[worker] duplicate job for message ${messageId} — already recorded, skipping buffer`);
      await dropPlaceholder(tenantId, from, waPhoneNumberId, job.data);
      return;
    }

    // Replaces a voice note's / photo's placeholder in place, keeping its spot.
    await putBuffered(tenantId, from, bufferEntry(job.data, text), "set");
    if (kind !== "text") {
      // The "still waiting on media" recheck (writeReply) isn't needed any
      // more — and firing later, it would skip the debounce for whatever the
      // customer sends next. If other media is still pending, the next flush
      // sets it up again.
      await replyDebounceQueue.remove(`${debounceJobId(tenantId, from)}_media`).catch(() => {});
    }

    await scheduleDebouncedReply(tenantId, from, waPhoneNumberId, text);
  },
  // Parallel across customers. BullMQ's default is ONE job at a time, which
  // made the 50th of 50 simultaneous customers wait ~2 minutes behind the
  // other 49 (e2e load test). Safe: each job is one customer's own message.
  { connection, concurrency: INBOUND_CONCURRENCY },
);

// --- Worker 2: fires once the debounce window passes with no new message —
// generates and sends ONE reply covering everything buffered since the last reply. ---
const replyWorker = new Worker<ReplyDebounceJob>(
  REPLY_DEBOUNCE_QUEUE,
  (job) => withReplyLock(job, () => writeReply(job)),
  // Parallel across customers; withReplyLock keeps it to one reply at a
  // time per customer. Kept under the DB pool size (10): each reply holds a
  // connection only between AI calls.
  { connection, concurrency: REPLY_CONCURRENCY },
);

async function writeReply(job: Job<ReplyDebounceJob>): Promise<void> {
  const { tenantId, from, waPhoneNumberId } = job.data;

  // Read (don't clear) the buffer — cleared only after a successful send,
  // so a retry after a transient failure (e.g. Gemini 503) re-reads the
  // same buffered messages instead of finding an empty list and silently
  // dropping the reply.
  const startedAt = Date.now();
  const entries = (await connection.lrange(bufferKey(tenantId, from), 0, -1)).map((raw) => ({ raw, msg: JSON.parse(raw) as BufferedMessage }));
  if (entries.length === 0) return; // nothing buffered (an earlier flush already answered it)

  // A voice note / photo still being read: wait for it, so it's answered
  // together with whatever was sent around it. Finishing it reschedules the
  // reply; this recheck only matters if its job dies without doing so.
  const stillReading = entries.filter((e) => e.msg.pending && startedAt - e.msg.at < PENDING_MAX_MS);
  if (stillReading.length > 0) {
    console.log(`[worker] ${from} has ${stillReading.length} voice note/file(s) still being read — holding the reply`);
    await scheduleFlush(`${debounceJobId(tenantId, from)}_media`, job.data, PENDING_RECHECK_MS);
    return;
  }
  const lost = entries.filter((e) => e.msg.pending);
  if (lost.length > 0) console.warn(`[worker] gave up waiting on ${lost.length} voice note/file(s) from ${from} — replying without them`);

  // Everything this reply covers — `lost` placeholders included, so they're cleared with it.
  const handled = entries.map((e) => e.raw);
  const buffered = entries.filter((e) => !e.msg.pending).map((e) => e.msg);
  if (buffered.length === 0) {
    await clearHandled(tenantId, from, handled);
    return;
  }
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
    // stepped in, or the chat was handed over (complaint, asked for a
    // person), the bot goes silent — no auto-reply — until the dashboard
    // resumes it back to 'bot'. 'flagged' is NOT silenced: the assistant
    // only couldn't answer one thing, and shouldn't ignore the customer's
    // next, perfectly answerable question while waiting for staff (it
    // used to — found by the e2e harness).
    const conversation = await getConversation(client, conversationId);
    if (conversation && isHumanHandled(conversation.status)) {
      return { skip: true as const, conversationId };
    }

    // History already contains each buffered message as its own turn (inserted by worker 1),
    // so the model sees them as sequential user turns rather than one flattened blob.
    // Long-term memory of this customer — what scrolled out of the
    // recent window, distilled (lib/conversationMemory.ts) — and the raw
    // history, which also includes anything the summary hasn't caught up
    // on yet, so no message is ever in neither.
    const { summary, summaryThroughMessageAt } = await getConversationMemory(client, conversationId);
    const history = await getReplyHistory(client, conversationId, HISTORY_LIMIT, summaryThroughMessageAt);
    const context = await loadBusinessContext(client);
    const lastReply = await getLastReply(client, conversationId);
    return { skip: false as const, conversationId, history, context, customerMemory: summary, lastReply };
  });

  if (convoState.skip) {
    console.log(`[worker] conversation with ${from} is human-handled — skipping auto-reply`);
    await clearHandled(tenantId, from, handled); // so they don't pile up; the human sees the raw messages in the dashboard
    return;
  }

  const { conversationId, history, context, customerMemory, lastReply } = convoState;
  const { services, documents } = context;

  // Show typing as soon as we know we're actually going to reply (not
  // right before send) — that's the whole point of it masking LLM latency.
  await sendTypingIndicator(waPhoneNumberId, lastMessageId);

  // The combined buffered text is a better intent signal for the FAQ
  // lookup than any single fragment.
  let systemPrompt = await buildReplySystemPrompt(tenant, context, combinedText, customerMemory, from);

  // The customer wrote this before they'd seen our last reply — the two
  // crossed, or ours is still unopened. Left alone, the model assumes they
  // read it and answers "as I mentioned above…" to someone who didn't.
  const firstSentAt = buffered[0].sentAt;
  if (lastReply && Math.abs(firstSentAt - lastReply.sentAt.getTime()) < CROSSED_WINDOW_MS && !(lastReply.readAt && lastReply.readAt.getTime() <= firstSentAt)) {
    console.log(`[worker] ${from} wrote before reading the last reply — telling the model`);
    systemPrompt += UNREAD_REPLY_NOTE;
  }

  // The messages this reply answers always go last. History is ordered by
  // when rows were saved, and a message that lands while the previous reply
  // is being sent is saved *before* that reply — so in time order the
  // history ends on a model turn, which Gemini rejects outright ("Requests
  // ending with a model turn are not supported"). Seen on a real phone.
  const unansweredIds = new Set(buffered.map((b) => b.messageId));
  const chatHistory: ChatTurn[] = [
    ...history
      .filter((m) => !(m.waMessageId && unansweredIds.has(m.waMessageId)))
      .map((m): ChatTurn => ({ role: m.direction === "in" ? "user" : "model", text: m.content })),
    ...buffered.map((b): ChatTurn => ({ role: "user", text: b.text })),
  ];

  // Combined tool palette — each family's own module owns executing its
  // own tool calls; this is just the dispatch between them by name, so
  // neither module needs to know the other exists.
  const actionTools = [...buildBookingTools(services), ...buildDocumentTools(documents)];
  const executeTool = (call: ToolCall): Promise<unknown> => {
    if (BOOKING_TOOL_NAMES.includes(call.name)) {
      return executeBookingTool({ tenantId, timezone: tenant.timezone, minNoticeMinutes: tenant.bookingMinNoticeMinutes, services, conversationId, contactWaNumber: from }, call);
    }
    if (DOCUMENT_TOOL_NAMES.includes(call.name)) {
      return executeDocumentTool({ tenantId, waPhoneNumberId, contactWaNumber: from, documents }, call);
    }
    return Promise.resolve({ error: `Unknown tool "${call.name}"` });
  };
  let result: Awaited<ReturnType<typeof runReplyTurn>>;
  try {
    result = await runReplyTurn(systemPrompt, chatHistory, actionTools, executeTool);
  } catch (err) {
    const toolCalls = err instanceof ReplyTurnFailedError ? err.toolCalls : [];
    const cause = err instanceof ReplyTurnFailedError ? err.cause : err;
    // Let the queue retry the whole job (a few seconds later, with backoff)
    // only while that's both SAFE — nothing with side effects ran yet, so
    // a rerun can't double-book — and USEFUL — the failure is the kind
    // that clears up (overload, rate limit), not a dead key. On the last
    // attempt, or when retrying can't help, the customer gets a holding
    // reply and the chat goes to a human instead of silence.
    const attemptsLeft = (job.opts.attempts ?? 1) - job.attemptsMade - 1;
    if (toolCalls.length === 0 && isTransientFailure(cause) && attemptsLeft > 0) {
      console.warn(`[worker] reply for ${from} failed, ${attemptsLeft} retr${attemptsLeft === 1 ? "y" : "ies"} left:`, cause);
      throw err;
    }
    console.error(`[worker] reply for ${from} failed for good — sending holding reply and handing to a human:`, cause);
    await sendHoldingReplyAndEscalate({ tenantId, from, waPhoneNumberId, conversationId, combinedText, toolCalls, handled });
    return;
  }

  // The customer sent more while this was being written — this reply
  // doesn't know about it (it's the "AI answered before I finished
  // typing" case). Unless a booking tool already did something real,
  // drop it: the newer message's own flush job answers everything
  // together, and the buffer still holds all of it. Not once the hard
  // cap was already up when this started, though — the customer has
  // waited long enough; this goes out and the new messages are the next turn.
  const oldestAt = Math.min(...buffered.map((b) => b.at));
  const withinCap = startedAt - oldestAt < config.messageMaxWaitMs - 1000;
  if (result.toolCalls.length === 0 && withinCap && (await hasNewMessages(tenantId, from, handled))) {
    const rewrites = await connection.incr(rewriteKey(tenantId, from));
    await connection.expire(rewriteKey(tenantId, from), 300);
    if (rewrites <= MAX_REWRITES) {
      console.log(`[worker] ${from} sent more while the reply was being written — rewriting it with the new message(s)`);
      return;
    }
  }

  // The owner replied from the dashboard (or the chat was handed over)
  // while this was being written — that was only checked when it started.
  // Don't talk over them. Unless a booking was just made, moved or
  // cancelled: the customer needs to hear about that.
  if (!result.toolCalls.some((t) => BOOKING_CHANGE_TOOL_NAMES.includes(t.name))) {
    const latest = await withTenant(tenantId, (client) => getConversation(client, conversationId));
    if (latest && isHumanHandled(latest.status)) {
      console.log(`[worker] a person took over the chat with ${from} while the reply was being written — not sending it`);
      await clearHandled(tenantId, from, handled);
      await connection.del(rewriteKey(tenantId, from));
      return;
    }
  }

  // Deliberately NOT persisted yet — see below. If sendTextMessage throws
  // (e.g. WhatsApp/Meta-side rejection), a message recorded here would
  // (a) show as "sent" in the dashboard when it never reached the
  // customer, and (b) poison the next retry's chatHistory above, which
  // would then end on a "model" turn instead of "user" — Gemini rejects
  // that outright, turning one WhatsApp-side failure into a second,
  // unrelated one that eats the rest of the retry budget.
  let sentId: string | undefined;
  try {
    sentId = await sendTextMessage(waPhoneNumberId, from, result.reply);
  } catch (err) {
    if (result.toolCalls.length > 0) {
      // A booking tool already made a REAL side effect this turn (a
      // Google Calendar event + a local bookings row) before the send
      // failed. Rethrowing would let BullMQ retry this whole job from the
      // top — re-running the LLM/tools from scratch and risking a genuine
      // duplicate booking, not just a duplicate reply. That's strictly
      // worse than an unconfirmed-by-text booking, so don't retry: record
      // what happened, escalate to a human to confirm with the customer
      // directly, and let the job succeed instead of throwing.
      console.error(
        `[worker] booking tool(s) succeeded but confirmation send failed for ${from} — not retrying (would risk a duplicate booking):`,
        err,
      );
      await clearHandled(tenantId, from, handled);
      await withTenant(tenantId, async (client) => {
        await insertMessage(client, tenantId, conversationId, "out", result.reply, undefined, result.toolCalls);
        await touchConversation(client, conversationId);
        await setConversationStatus(client, conversationId, "needs_human");
      });
      await notifyEscalation(
        waPhoneNumberId,
        from,
        combinedText,
        "booking was confirmed but WhatsApp send failed — please follow up with the customer directly",
      );
      return;
    }
    // No external side effect happened (plain FAQ turn) — safe to let
    // BullMQ retry the whole job, same as before.
    const attemptsLeft = (job.opts.attempts ?? 1) - job.attemptsMade - 1;
    if (attemptsLeft > 0) throw err;
    // Out of retries: WhatsApp keeps refusing this reply. Previously the
    // job just died — the customer got nothing and nobody found out.
    // Hand the chat to a human so it shows up in "Needs you", tell the
    // business, and alert the operator: a send that keeps failing is
    // usually OUR problem (expired token, number restricted by Meta).
    console.error(`[worker] WhatsApp refused every attempt to reply to ${from} — handing to a human:`, err);
    await clearHandled(tenantId, from, handled);
    await withTenant(tenantId, (client) => setConversationStatus(client, conversationId, "needs_human"));
    const why = err instanceof Error ? err.message : String(err);
    await alertOperator(`sendfail:${waPhoneNumberId}`, `WhatsApp is refusing replies from number ${waPhoneNumberId} (${why.slice(0, 200)}). Check the access token and the number's status in WhatsApp Manager.`);
    try {
      await notifyEscalation(waPhoneNumberId, from, combinedText, "the assistant's reply couldn't be delivered on WhatsApp — please contact the customer");
    } catch (notifyErr) {
      // Same channel, likely the same failure — the ops alert above is logged regardless.
      console.error(`[worker] couldn't notify the business either:`, notifyErr);
    }
    return;
  }
  await clearHandled(tenantId, from, handled); // only once the reply has actually gone out
  await connection.del(rewriteKey(tenantId, from));

  // Only record the reply (and any state it implies) once it's actually
  // out the door — see the comment above.
  await withTenant(tenantId, async (client) => {
    await insertMessage(client, tenantId, conversationId, "out", result.reply, sentId, result.toolCalls);
    await touchConversation(client, conversationId);
    if (result.escalate) {
      await setConversationStatus(client, conversationId, result.escalateKind === "follow_up" ? "flagged" : "needs_human");
    }
  });

  // Fold anything that just scrolled out of the history window into the
  // conversation's long-term memory. Strictly after the reply is sent and
  // recorded, and swallowing its own errors: the customer already has
  // their reply, so a summarization hiccup must never fail this job and
  // trigger a retry that re-sends it.
  try {
    await maybeUpdateConversationSummary(tenantId, conversationId);
  } catch (err) {
    console.warn(`[worker] conversation summary update failed for ${conversationId} (reply already sent):`, err);
  }

  if (result.escalate) {
    const followUp = result.escalateKind === "follow_up";
    console.log(`[worker] ${followUp ? "flagging" : "handing over"} conversation with ${from}: ${result.escalateReason ?? "unspecified"}`);
    await notifyEscalation(
      waPhoneNumberId,
      from,
      combinedText,
      followUp
        ? `${result.escalateReason ?? "assistant couldn't answer"} (assistant is still replying — follow up when you can)`
        : `${result.escalateReason ?? "needs a person"} (assistant paused — please reply)`,
    );
  }
}

// --- Worker 2b: delivery receipts for messages we sent. "read" is what
// writeReply checks to tell whether the customer saw its last reply before
// writing again; "failed" (24h window closed, number blocked...) means a
// reply we recorded as sent never reached them — flag it for the owner. ---
const statusWorker = new Worker<MessageStatusJob>(
  MESSAGE_STATUS_QUEUE,
  async (job) => {
    const { waPhoneNumberId, waMessageId, status, at, reason } = job.data;
    const tenant = await getTenantByPhoneNumberId(waPhoneNumberId);
    if (!tenant) return;
    const tenantId = tenant.id;

    const updated = await withTenant(tenantId, (client) => recordDeliveryStatus(client, waMessageId, status, new Date(at), reason));
    if (!updated) {
      // Usually a message we don't record (owner notifications). But a
      // failure can be reported before the reply's own row is saved, a
      // moment after the send — worth a few quick retries for that one.
      const attemptsLeft = (job.opts.attempts ?? 1) - job.attemptsMade - 1;
      if (status === "failed" && attemptsLeft > 0) throw new Error(`no recorded message ${waMessageId} yet for its "failed" receipt`);
      return;
    }
    if (status !== "failed" || !updated.firstFailure) return;

    console.warn(`[worker] WhatsApp couldn't deliver message ${waMessageId}: ${reason ?? "no reason given"}`);
    const conversation = await withTenant(tenantId, async (client) => {
      const c = await getConversation(client, updated.conversationId);
      // Flagged, not handed over: if the customer writes again, the
      // assistant can answer (that reopens the window), while the owner sees
      // the chat under "Needs you". Never downgrades a handed-over chat.
      if (c && c.status === "bot") await setConversationStatus(client, c.id, "flagged");
      return c;
    });
    if (!conversation) return;
    await notifyEscalation(
      waPhoneNumberId,
      conversation.waNumber,
      updated.content,
      `this reply never reached the customer on WhatsApp${reason ? ` (${reason})` : ""} — please contact them another way`,
    );
  },
  { connection, concurrency: 5 },
);

// --- Worker 3: fires once per booking, LEAD_TIME_HOURS before its start
// (scheduled by lib/bookingReminders.ts at booking time, cancelled on
// cancel/reschedule). Sends via a pre-approved WhatsApp template, since a
// reminder this far ahead is almost always outside the 24h customer-service
// window that plain text messages require. ---
const reminderWorker = new Worker<ReminderJob>(
  REMINDER_QUEUE,
  async (job) => {
    const { tenantId, bookingId } = job.data;

    const booking = await withTenant(tenantId, (client) => getBookingById(client, bookingId));
    // Booking gone, or cancelled/rescheduled after this job was already
    // picked up (cancelReminder can't remove an "active" job) — either way,
    // nothing to remind about.
    if (!booking || booking.status !== "confirmed") {
      console.log(`[worker] skipping reminder for booking ${bookingId} — no longer a confirmed booking`);
      return;
    }

    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found for reminder on booking ${bookingId}`);
    }
    if (!tenant.whatsappPhoneNumberId) {
      console.log(`[worker] skipping reminder for booking ${bookingId} — tenant has no WhatsApp number connected`);
      return;
    }

    const start = DateTime.fromISO(booking.startsAt).setZone(tenant.timezone);
    const end = DateTime.fromISO(booking.endsAt).setZone(tenant.timezone);
    const formattedRange = `${start.toFormat("EEE d LLL")}, ${start.toFormat("h:mm a")} - ${end.toFormat("h:mm a")}`;
    const serviceName = booking.serviceName ?? "appointment";

    const sentId = await sendTemplateMessage(
      tenant.whatsappPhoneNumberId,
      booking.contactWaNumber,
      REMINDER_TEMPLATE_NAME,
      REMINDER_TEMPLATE_LANGUAGE,
      reminderBodyParams(serviceName, formattedRange),
    );

    // Mark sent right after the send succeeds, before anything non-essential
    // below — the atomic `WHERE reminder_sent_at IS NULL` guard is what
    // stops a BullMQ retry (if something after this point fails) from
    // sending the template a second time.
    const wasFirstSend = await withTenant(tenantId, (client) => markReminderSent(client, bookingId));
    if (!wasFirstSend) {
      console.log(`[worker] reminder for booking ${bookingId} was already marked sent — not logging a duplicate message`);
      return;
    }

    if (booking.conversationId) {
      await withTenant(tenantId, async (client) => {
        await insertMessage(client, tenantId, booking.conversationId!, "out", reminderPlainText(serviceName, formattedRange), sentId);
        await touchConversation(client, booking.conversationId!);
      });
    }
  },
  { connection, concurrency: 5 },
);

// --- Worker 4: website/social import into a Knowledge draft (lib/businessImport.ts).
// runImport records every outcome itself, so it never fails the job. ---
const importWorker = new Worker<BusinessImportJob>(BUSINESS_IMPORT_QUEUE, (job) => runImport(job.data), { connection, concurrency: 2 });

for (const w of [inboundWorker, replyWorker, statusWorker, reminderWorker, importWorker]) {
  w.on("completed", (job) => console.log(`[worker] job ${job.id} completed`));
  w.on("failed", (job, err) => console.error(`[worker] job ${job?.id} failed:`, err));
}

console.log("Worker started, waiting for inbound messages...");

// Reminders live in Redis, which may have restarted empty — rebuild them from
// the bookings table. Never blocks startup or crashes the process.
restoreReminders()
  .then((n) => console.log(`[worker] reminders restored from the database: ${n}`))
  .catch((err) => console.error("[worker] restoring reminders failed:", err));
