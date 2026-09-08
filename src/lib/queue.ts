import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";

export const connection = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

// --- Queue 1: raw inbound events. Every message Meta sends us, recorded and
// buffered immediately, regardless of when (or whether) a reply goes out. ---
export const INBOUND_MESSAGE_QUEUE = "inbound-messages";

export interface InboundMessageJob {
  tenantId: string;
  waPhoneNumberId: string;
  from: string;
  messageId: string;
  receivedAt: string;
  kind: "text" | "audio" | "image" | "document" | "unsupported";
  text?: string;
  mediaId?: string;
  mimeType?: string;
  /** Images/documents: the customer's own words attached to the file, which are usually the actual question. */
  caption?: string;
  /** Documents only — worth showing the customer we know which file they sent. */
  filename?: string;
}

export const inboundQueue = new Queue<InboundMessageJob>(INBOUND_MESSAGE_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 1000,
  },
});

// --- Queue 2: the debounced "actually reply now" trigger, one delayed job
// per contact (jobId = wa_number). Each new inbound message removes and
// re-adds this job, so only the one that survives the delay untouched fires. ---
export const REPLY_DEBOUNCE_QUEUE = "reply-debounce";

export interface ReplyDebounceJob {
  tenantId: string;
  from: string;
  waPhoneNumberId: string;
}

export const replyDebounceQueue = new Queue<ReplyDebounceJob>(REPLY_DEBOUNCE_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 1000,
  },
});

// --- Queue 3: booking reminders. One delayed job per booking (jobId =
// booking id), scheduled at booking time and fired a fixed lead time before
// the appointment. Cancelling/rescheduling a booking removes its job — see
// lib/bookingReminders.ts, the one place jobs on this queue are added/removed. ---
export const REMINDER_QUEUE = "booking-reminders";

export interface ReminderJob {
  tenantId: string;
  bookingId: string;
}

export const reminderQueue = new Queue<ReminderJob>(REMINDER_QUEUE, {
  connection,
  defaultJobOptions: {
    // A few more attempts than the other queues, with longer backoff — if a
    // reminder fires right as the WhatsApp template is still pending Meta's
    // approval, it's worth a few slower retries rather than giving up fast.
    attempts: 5,
    backoff: { type: "exponential", delay: 60_000 },
    removeOnComplete: 1000,
    removeOnFail: 1000,
  },
});
