import crypto from "node:crypto";
import { config } from "./config.js";

const GRAPH_API_VERSION = "v21.0";
// Overridable only so the e2e harness (e2e/) can point every Meta call at a
// local mock — production never sets WHATSAPP_GRAPH_BASE.
const GRAPH = `${config.whatsapp.graphBase}/${GRAPH_API_VERSION}`;

export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = crypto
    .createHmac("sha256", config.whatsapp.appSecret)
    .update(rawBody)
    .digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

/** WhatsApp's id for a message we just sent — what its later delivered/read/failed status updates refer to. */
async function sentMessageId(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { messages?: Array<{ id?: string }> };
    return body.messages?.[0]?.id;
  } catch {
    return undefined; // sent fine, just no id to track receipts by
  }
}

/** Returns the sent message's WhatsApp id (for read receipts), when Meta gives one. */
export async function sendTextMessage(phoneNumberId: string, to: string, body: string): Promise<string | undefined> {
  const url = `${GRAPH}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`WhatsApp send failed (${res.status}): ${errBody}`);
  }
  return sentMessageId(res);
}

/**
 * Sends a document (PDF, image, spreadsheet, etc.) by public link — Meta's
 * servers fetch `link` themselves rather than us uploading bytes here, so
 * it must be reachable over plain HTTPS with no auth (routes/files.ts).
 */
export async function sendDocumentMessage(phoneNumberId: string, to: string, link: string, filename: string, caption?: string): Promise<void> {
  const url = `${GRAPH}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: { link, filename, caption },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`WhatsApp document send failed (${res.status}): ${errBody}`);
  }
}

/**
 * Sends a pre-approved WhatsApp message template — required for any
 * proactive message (booking reminders, follow-ups) outside the 24h
 * customer-service window, where a plain text send (sendTextMessage) is
 * rejected outright by Meta. `bodyParams` fill the template's {{1}}, {{2}}...
 * placeholders in order.
 */
export async function sendTemplateMessage(
  phoneNumberId: string,
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[],
): Promise<string | undefined> {
  const url = `${GRAPH}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: bodyParams.length > 0 ? [{ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) }] : undefined,
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`WhatsApp template send failed (${res.status}): ${errBody}`);
  }
  return sentMessageId(res);
}

/** Downloads a media attachment (voice note, image, etc.) by its WhatsApp media id. */
export async function downloadMedia(mediaId: string): Promise<{ data: Buffer; mimeType: string }> {
  const metaRes = await fetch(`${GRAPH}/${mediaId}`, {
    headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
  });
  if (!metaRes.ok) {
    throw new Error(`WhatsApp media lookup failed (${metaRes.status}): ${await metaRes.text()}`);
  }
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) {
    throw new Error(`WhatsApp media lookup response missing url: ${JSON.stringify(meta)}`);
  }

  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
  });
  if (!fileRes.ok) {
    throw new Error(`WhatsApp media download failed (${fileRes.status})`);
  }
  const data = Buffer.from(await fileRes.arrayBuffer());
  return { data, mimeType: meta.mime_type ?? "application/octet-stream" };
}

/**
 * Marks the given inbound message as read and shows the typing indicator
 * (shown for up to 25s, or until the next message is sent). Best-effort —
 * never throws, since a missing typing indicator shouldn't fail the job.
 */
export async function sendTypingIndicator(phoneNumberId: string, replyToMessageId: string): Promise<void> {
  try {
    const url = `${GRAPH}/${phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.whatsapp.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: replyToMessageId,
        typing_indicator: { type: "text" },
      }),
    });
    if (!res.ok) {
      console.warn(`WhatsApp typing indicator failed (${res.status}): ${await res.text()}`);
    }
  } catch (err) {
    console.warn("WhatsApp typing indicator error:", err);
  }
}
