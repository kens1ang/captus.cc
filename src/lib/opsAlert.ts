import { config } from "./config.js";
import { sendTextMessage } from "./whatsapp.js";

// Alerts for the person RUNNING Captus (Gemini key revoked, billing, daily
// quota gone, a model retired, every model failing) — distinct from
// escalation.ts, which tells a business that one of its chats needs a human.
// The business owner can't fix a Gemini key, and doesn't need to know about
// one; their customer just gets handed to them via the normal escalation.

const DEDUPE_MS = 60 * 60 * 1000;
// In-memory is enough: backend + worker run as one process (src/main.ts). A
// restart can re-send an alert once, which is fine.
const lastSent = new Map<string, number>();

/**
 * Logs with a greppable `[OPS ALERT]` tag (search Render logs for it) and
 * WhatsApps OWNER_NOTIFY_NUMBER — at most once an hour per `key`, so an
 * outage doesn't turn into a message per customer. Never throws: alerting
 * must not be the thing that breaks a reply.
 */
export async function alertOperator(key: string, message: string): Promise<void> {
  console.error(`[OPS ALERT] ${key}: ${message}`);

  const now = Date.now();
  if ((lastSent.get(key) ?? 0) > now - DEDUPE_MS) return;
  lastSent.set(key, now);

  const to = config.ownerNotifyNumber;
  const from = config.opsAlertPhoneNumberId;
  if (!to || !from) return;
  try {
    await sendTextMessage(from, to, `⚠️ Captus ops alert\n${message}`);
  } catch (err) {
    // Commonly: owner hasn't messaged this number in 24h, so free-form
    // messages are refused. The log line above is the fallback record.
    console.error(`[OPS ALERT] couldn't deliver WhatsApp alert for ${key}:`, err);
  }
}
