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
  kind: "text" | "audio" | "unsupported";
  text?: string;
  mediaId?: string;
  mimeType?: string;
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
