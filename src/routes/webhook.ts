import type { FastifyInstance } from "fastify";
import { config } from "../lib/config.js";
import { verifyWebhookSignature } from "../lib/whatsapp.js";
import { inboundQueue } from "../lib/queue.js";
import { getTenantByPhoneNumberId } from "../db/tenants.js";

interface MetaWebhookBody {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: Array<{ wa_id: string }>;
        messages?: Array<{
          id: string;
          from: string;
          timestamp: string;
          type: string;
          text?: { body: string };
          audio?: { id: string; mime_type: string };
          image?: { id: string; mime_type: string; caption?: string };
          document?: { id: string; mime_type: string; filename?: string; caption?: string };
        }>;
      };
    }>;
  }>;
}

export async function webhookRoutes(app: FastifyInstance) {
  // Meta's one-time webhook verification handshake (done once when you configure the webhook URL in the dashboard).
  app.get("/webhook", async (req, reply) => {
    const query = req.query as Record<string, string>;
    const mode = query["hub.mode"];
    const token = query["hub.verify_token"];
    const challenge = query["hub.challenge"];

    if (mode === "subscribe" && token === config.whatsapp.verifyToken) {
      return reply.code(200).send(challenge);
    }
    return reply.code(403).send("Forbidden");
  });

  // Inbound messages + status updates. Must ack fast (<5s) — no LLM calls or slow work here.
  app.post("/webhook", async (req, reply) => {
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const rawBody = req.rawBody as Buffer;

    if (!verifyWebhookSignature(rawBody, signature)) {
      req.log.warn("Rejected webhook with invalid signature");
      return reply.code(401).send("Invalid signature");
    }

    // Ack immediately; do all real work in the worker.
    reply.code(200).send("EVENT_RECEIVED");

    const body = req.body as MetaWebhookBody;
    req.log.info({ body }, "Inbound webhook payload");

    const value = body.entry?.[0]?.changes?.[0]?.value;
    const phoneNumberId = value?.metadata?.phone_number_id;
    const displayPhoneNumber = value?.metadata?.display_phone_number;
    const messages = value?.messages ?? [];

    if (messages.length === 0) return;

    if (!phoneNumberId) {
      req.log.warn("Inbound webhook missing phone_number_id — skipping");
      return;
    }

    // Stage 3: one webhook endpoint serves every tenant, routed by which
    // WhatsApp number the message arrived on.
    const tenant = await getTenantByPhoneNumberId(phoneNumberId);
    if (!tenant) {
      req.log.warn({ phoneNumberId }, "No tenant configured for this WhatsApp number — skipping");
      return;
    }

    for (const message of messages) {
      // Defensive: never let the bot reply to an echo of its own outbound
      // number, or to a payload shaped like a group/broadcast (WhatsApp
      // Business Platform doesn't support groups, but a malformed or
      // unexpected payload here is exactly the class of bug that causes a
      // reply loop and gets the number banned).
      if (displayPhoneNumber && message.from === displayPhoneNumber) {
        req.log.warn({ messageId: message.id }, "Skipping apparent echo of our own number");
        continue;
      }
      if ((value?.contacts?.length ?? 0) > 1) {
        req.log.warn({ messageId: message.id }, "Skipping multi-contact (group-like) payload");
        continue;
      }

      const base = {
        tenantId: tenant.id,
        waPhoneNumberId: phoneNumberId,
        from: message.from,
        messageId: message.id,
        receivedAt: new Date().toISOString(),
      };

      // Stage 2 idempotency: Meta redelivers webhooks it didn't get a fast ack
      // for. Using the WhatsApp message id as the BullMQ jobId means a
      // redelivered duplicate is a no-op instead of a second reply.
      if (message.type === "text") {
        await inboundQueue.add(
          "inbound",
          { ...base, kind: "text", text: message.text?.body ?? "" },
          { jobId: message.id },
        );
      } else if (message.type === "audio" && message.audio) {
        await inboundQueue.add(
          "inbound",
          { ...base, kind: "audio", mediaId: message.audio.id, mimeType: message.audio.mime_type },
          { jobId: message.id },
        );
      } else if (message.type === "image" && message.image) {
        await inboundQueue.add(
          "inbound",
          {
            ...base,
            kind: "image",
            mediaId: message.image.id,
            mimeType: message.image.mime_type,
            caption: message.image.caption,
          },
          { jobId: message.id },
        );
      } else if (message.type === "document" && message.document) {
        await inboundQueue.add(
          "inbound",
          {
            ...base,
            kind: "document",
            mediaId: message.document.id,
            mimeType: message.document.mime_type,
            filename: message.document.filename,
            caption: message.document.caption,
          },
          { jobId: message.id },
        );
      } else {
        // Stickers, locations, contacts, etc. — still acknowledged and
        // escalated rather than silently dropped (worker.ts's "unsupported"
        // branch). Images and documents used to land here too.
        await inboundQueue.add("inbound", { ...base, kind: "unsupported" }, { jobId: message.id });
      }
    }
  });
}
