import crypto from "node:crypto";
import { config } from "./config.js";

const GRAPH_API_VERSION = "v21.0";

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

export async function sendTextMessage(phoneNumberId: string, to: string, body: string): Promise<void> {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
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
}

/** Downloads a media attachment (voice note, image, etc.) by its WhatsApp media id. */
export async function downloadMedia(mediaId: string): Promise<{ data: Buffer; mimeType: string }> {
  const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, {
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
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
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
