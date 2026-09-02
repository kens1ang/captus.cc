import type { FastifyInstance } from "fastify";
import { requireDashboardAuth } from "../lib/clerkAuth.js";
import { withTenant } from "../db/tenantContext.js";
import { getTenantById } from "../db/tenants.js";
import { sendTextMessage } from "../lib/whatsapp.js";
import { ingestKnowledgeText } from "../lib/knowledgeIngest.js";
import {
  listConversations,
  getConversation,
  getAllMessages,
  setConversationStatus,
  insertMessage,
  touchConversation,
} from "../db/conversations.js";
import { listKnowledgeChunks, deleteKnowledgeChunk } from "../db/knowledge.js";

// Stage 4's "bare dashboard" API: conversation list, thread view + manual
// reply/resume (human takeover), FAQ list/add/delete. All routes require a
// verified Clerk session resolved to a tenant (see lib/clerkAuth.ts) and run
// through withTenant() so RLS scopes every query to that tenant only.
export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireDashboardAuth);

  // Lets the dashboard's nav know whether to show the admin link, without
  // duplicating the tenant-scoped conversation/knowledge fetch just for that.
  app.get("/api/me", async (req) => {
    const { tenantId, email, role, isAdmin } = req.dashboardUser!;
    return { tenantId, email, role, isAdmin };
  });

  app.get("/api/conversations", async (req) => {
    const tenantId = req.dashboardUser!.tenantId;
    return withTenant(tenantId, (client) => listConversations(client));
  });

  app.get<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
    const tenantId = req.dashboardUser!.tenantId;
    const conversation = await withTenant(tenantId, (client) => getConversation(client, req.params.id));
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
    return conversation;
  });

  app.get<{ Params: { id: string } }>("/api/conversations/:id/messages", async (req, reply) => {
    const tenantId = req.dashboardUser!.tenantId;
    const conversation = await withTenant(tenantId, (client) => getConversation(client, req.params.id));
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
    const messages = await withTenant(tenantId, (client) => getAllMessages(client, req.params.id));
    return messages;
  });

  // Manual reply — human takeover. Sends the message and flips the
  // conversation to 'human_active' so the worker stops auto-replying
  // (architecture doc §5.6).
  app.post<{ Params: { id: string }; Body: { text: string } }>("/api/conversations/:id/reply", async (req, reply) => {
    const tenantId = req.dashboardUser!.tenantId;
    const text = req.body?.text?.trim();
    if (!text) return reply.code(400).send({ error: "text is required" });

    const conversation = await withTenant(tenantId, (client) => getConversation(client, req.params.id));
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });

    const tenant = await getTenantById(tenantId);
    if (!tenant) return reply.code(500).send({ error: "Tenant not found" });

    // Send first — only record it (and flip to human_active) once WhatsApp
    // actually has it. Otherwise a failed send (e.g. a Meta-side rejection)
    // still shows up in the dashboard as a sent reply that the customer never
    // received. Let it throw straight to a 500 on failure; nothing written.
    await sendTextMessage(tenant.whatsappPhoneNumberId, conversation.waNumber, text);

    await withTenant(tenantId, async (client) => {
      await insertMessage(client, tenantId, conversation.id, "out", text);
      await setConversationStatus(client, conversation.id, "human_active");
      await touchConversation(client, conversation.id);
    });

    return { ok: true };
  });

  // Hand control back to the bot.
  app.post<{ Params: { id: string } }>("/api/conversations/:id/resume", async (req, reply) => {
    const tenantId = req.dashboardUser!.tenantId;
    const conversation = await withTenant(tenantId, (client) => getConversation(client, req.params.id));
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });

    await withTenant(tenantId, (client) => setConversationStatus(client, conversation.id, "bot"));
    return { ok: true };
  });

  app.get("/api/knowledge", async (req) => {
    const tenantId = req.dashboardUser!.tenantId;
    return withTenant(tenantId, (client) => listKnowledgeChunks(client));
  });

  app.post<{ Body: { text: string; source?: string } }>("/api/knowledge", async (req, reply) => {
    const tenantId = req.dashboardUser!.tenantId;
    const text = req.body?.text?.trim();
    if (!text) return reply.code(400).send({ error: "text is required" });

    const count = await ingestKnowledgeText(tenantId, text, req.body.source ?? "dashboard");
    return { ok: true, chunksAdded: count };
  });

  app.delete<{ Params: { id: string } }>("/api/knowledge/:id", async (req, reply) => {
    const tenantId = req.dashboardUser!.tenantId;
    const deleted = await withTenant(tenantId, (client) => deleteKnowledgeChunk(client, req.params.id));
    if (!deleted) return reply.code(404).send({ error: "Chunk not found" });
    return { ok: true };
  });
}
