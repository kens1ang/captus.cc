import type { FastifyInstance } from "fastify";
import { requireDashboardAuth } from "../lib/clerkAuth.js";
import { withTenant } from "../db/tenantContext.js";
import { getTenantById, updateTenantBookingNotice, updateTenantTimezone, updateTenantProfile } from "../db/tenants.js";
import { sendTextMessage } from "../lib/whatsapp.js";
import { ingestKnowledgeText, replaceKnowledgeSource } from "../lib/knowledgeIngest.js";
import { listBusinessInfo, upsertBusinessInfo } from "../db/businessInfo.js";
import { isSectionKey, normalizeSection, renderIndexedChunks, knowledgeSourceFor, INDEXED_SECTIONS } from "../lib/businessInfo.js";
import {
  listConversations,
  getConversation,
  getAllMessages,
  setConversationStatus,
  insertMessage,
  touchConversation,
} from "../db/conversations.js";
import { listKnowledgeChunks, deleteKnowledgeChunk } from "../db/knowledge.js";
import { listServices, createService, updateService, deleteService } from "../db/services.js";
import { listBusinessHours, replaceBusinessHours, type BusinessHoursInterval } from "../db/businessHours.js";
import { listUpcomingBookings, cancelBooking } from "../db/bookings.js";
import { deleteCalendarEvent } from "../lib/googleCalendar.js";
import { cancelReminder } from "../lib/bookingReminders.js";
import { listDocuments, createDocument, deleteDocument } from "../db/documents.js";
import { REMINDER_TEMPLATE_NAME } from "../lib/bookingReminders.js";
import {
  listTemplates,
  createTemplate,
  deleteTemplate,
  validateTemplateInput,
  MetaApiError,
  type CreateTemplateInput,
} from "../lib/whatsappTemplates.js";

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
    const tenant = await getTenantById(tenantId);
    return {
      tenantId,
      email,
      role,
      isAdmin,
      businessName: tenant?.businessName ?? "",
      whatsappPhoneNumberId: tenant?.whatsappPhoneNumberId ?? "",
    };
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
    if (!tenant.whatsappPhoneNumberId) return reply.code(409).send({ error: "No WhatsApp number connected yet" });

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

  // --- Structured business info (dashboard Knowledge pages) — see lib/businessInfo.ts ---

  app.get("/api/business-info", async (req) => {
    const tenantId = req.dashboardUser!.tenantId;
    const [tenant, rows] = await Promise.all([
      getTenantById(tenantId),
      withTenant(tenantId, (client) => listBusinessInfo(client)),
    ]);
    return {
      businessName: tenant?.businessName ?? "",
      businessDescription: tenant?.businessDescription ?? "",
      sections: Object.fromEntries(rows.map((r) => [r.section, { data: r.data, updatedAt: r.updatedAt }])),
    };
  });

  app.put<{ Params: { section: string }; Body: { data: unknown; businessName?: string; businessDescription?: string } }>(
    "/api/business-info/:section",
    async (req, reply) => {
      const tenantId = req.dashboardUser!.tenantId;
      const { section } = req.params;
      if (!isSectionKey(section)) return reply.code(404).send({ error: "Unknown section" });
      const data = normalizeSection(section, req.body?.data);

      // The business name/description predate business_info and live on
      // `tenants` (the prompt and admin page read them there), so the profile
      // section writes them through rather than storing a second copy.
      if (section === "profile") {
        const businessName = req.body?.businessName?.trim();
        if (!businessName) return reply.code(400).send({ error: "businessName is required" });
        const businessDescription = (req.body?.businessDescription ?? "").trim().slice(0, 3000);
        await updateTenantProfile(tenantId, businessName.slice(0, 200), businessDescription);
      }

      if (INDEXED_SECTIONS.includes(section)) {
        const chunks = renderIndexedChunks(section, data);
        const chunksIndexed = await replaceKnowledgeSource(tenantId, knowledgeSourceFor(section), chunks, (client) =>
          upsertBusinessInfo(client, tenantId, section, data),
        );
        return { ok: true, data, chunksIndexed };
      }

      await withTenant(tenantId, (client) => upsertBusinessInfo(client, tenantId, section, data));
      return { ok: true, data };
    },
  );

  // --- Stage 5: booking settings (services, business hours) + bookings list ---

  app.get("/api/settings", async (req) => {
    const tenant = await getTenantById(req.dashboardUser!.tenantId);
    return { timezone: tenant?.timezone ?? "Asia/Singapore", bookingMinNoticeMinutes: tenant?.bookingMinNoticeMinutes ?? 30 };
  });

  // Either field on its own: the timezone lives on Settings, the notice on Booking setup.
  app.put<{ Body: { timezone?: string; bookingMinNoticeMinutes?: number } }>("/api/settings", async (req, reply) => {
    const tenantId = req.dashboardUser!.tenantId;
    const timezone = req.body?.timezone?.trim();
    const notice = req.body?.bookingMinNoticeMinutes;
    if (!timezone && notice === undefined) return reply.code(400).send({ error: "timezone or bookingMinNoticeMinutes is required" });
    if (notice !== undefined && (!Number.isInteger(notice) || notice < 0 || notice > 60 * 24 * 30)) {
      return reply.code(400).send({ error: "bookingMinNoticeMinutes must be a whole number of minutes, 0 to 30 days" });
    }
    if (timezone) await updateTenantTimezone(tenantId, timezone);
    if (notice !== undefined) await updateTenantBookingNotice(tenantId, notice);
    return { ok: true };
  });

  app.get("/api/services", async (req) => {
    const tenantId = req.dashboardUser!.tenantId;
    return withTenant(tenantId, (client) => listServices(client));
  });

  app.post<{ Body: { name: string; durationMinutes: number; capacity?: number } }>("/api/services", async (req, reply) => {
    const tenantId = req.dashboardUser!.tenantId;
    const name = req.body?.name?.trim();
    const durationMinutes = Number(req.body?.durationMinutes);
    const capacity = Number(req.body?.capacity ?? 1);
    if (!name || !Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      return reply.code(400).send({ error: "name and a positive durationMinutes are required" });
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
      return reply.code(400).send({ error: "capacity must be a whole number from 1 to 100" });
    }
    const service = await withTenant(tenantId, (client) => createService(client, tenantId, name, durationMinutes, capacity));
    return service;
  });

  app.patch<{ Params: { id: string }; Body: { durationMinutes: number; capacity: number } }>("/api/services/:id", async (req, reply) => {
    const tenantId = req.dashboardUser!.tenantId;
    const durationMinutes = Number(req.body?.durationMinutes);
    const capacity = Number(req.body?.capacity);
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      return reply.code(400).send({ error: "durationMinutes must be a positive whole number" });
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
      return reply.code(400).send({ error: "capacity must be a whole number from 1 to 100" });
    }
    const service = await withTenant(tenantId, (client) => updateService(client, req.params.id, { durationMinutes, capacity }));
    if (!service) return reply.code(404).send({ error: "Service not found" });
    return service;
  });

  app.delete<{ Params: { id: string } }>("/api/services/:id", async (req, reply) => {
    const tenantId = req.dashboardUser!.tenantId;
    const deleted = await withTenant(tenantId, (client) => deleteService(client, req.params.id));
    if (!deleted) return reply.code(404).send({ error: "Service not found" });
    return { ok: true };
  });

  app.get("/api/business-hours", async (req) => {
    const tenantId = req.dashboardUser!.tenantId;
    return withTenant(tenantId, (client) => listBusinessHours(client));
  });

  // Replaces the whole week at once — see db/businessHours.ts for why.
  app.put<{ Body: { intervals: BusinessHoursInterval[] } }>("/api/business-hours", async (req, reply) => {
    const tenantId = req.dashboardUser!.tenantId;
    const intervals = req.body?.intervals;
    if (!Array.isArray(intervals)) return reply.code(400).send({ error: "intervals array is required" });
    await withTenant(tenantId, (client) => replaceBusinessHours(client, tenantId, intervals));
    return { ok: true };
  });

  app.get("/api/bookings", async (req) => {
    const tenantId = req.dashboardUser!.tenantId;
    return withTenant(tenantId, (client) => listUpcomingBookings(client));
  });

  app.post<{ Params: { id: string } }>("/api/bookings/:id/cancel", async (req, reply) => {
    const tenantId = req.dashboardUser!.tenantId;
    const cancelled = await withTenant(tenantId, (client) => cancelBooking(client, req.params.id));
    if (!cancelled) return reply.code(404).send({ error: "Booking not found or already cancelled" });
    await cancelReminder(cancelled.id);

    // Best-effort — the cancellation itself already happened in our DB (the
    // part that actually matters); a Google-side hiccup here shouldn't turn
    // a successful cancel into a 500 the dashboard shows as an error.
    if (cancelled.googleEventId) {
      try {
        await deleteCalendarEvent(tenantId, cancelled.googleEventId);
      } catch (err) {
        req.log.warn({ err, bookingId: cancelled.id }, "Failed to delete Google Calendar event for a cancelled booking");
      }
    }

    // Let the customer know — they booked this via WhatsApp, so a
    // dashboard-side cancellation should reach them the same way, not leave
    // them showing up expecting an appointment that's gone.
    const tenant = await getTenantById(tenantId);
    if (tenant?.whatsappPhoneNumberId) {
      const notice = `Your ${cancelled.serviceName ?? "appointment"} has been cancelled. Let us know if you'd like to book another time.`;
      try {
        await sendTextMessage(tenant.whatsappPhoneNumberId, cancelled.contactWaNumber, notice);
        if (cancelled.conversationId) {
          await withTenant(tenantId, async (client) => {
            await insertMessage(client, tenantId, cancelled.conversationId!, "out", notice);
            await touchConversation(client, cancelled.conversationId!);
          });
        }
      } catch (err) {
        req.log.warn({ err, bookingId: cancelled.id }, "Failed to notify customer of dashboard-side booking cancellation");
      }
    }

    return { ok: true };
  });

  // --- Documents (menus, catalogs, price lists) the bot can send on request ---

  app.get("/api/documents", async (req) => {
    const tenantId = req.dashboardUser!.tenantId;
    return withTenant(tenantId, (client) => listDocuments(client));
  });

  app.post<{ Body: { name: string; description?: string; filename: string; mimeType: string; fileDataBase64: string } }>(
    "/api/documents",
    async (req, reply) => {
      const tenantId = req.dashboardUser!.tenantId;
      const { name, description, filename, mimeType, fileDataBase64 } = req.body ?? ({} as never);
      if (!name?.trim() || !filename?.trim() || !mimeType?.trim() || !fileDataBase64) {
        return reply.code(400).send({ error: "name, filename, mimeType, and fileDataBase64 are required" });
      }
      const document = await withTenant(tenantId, (client) =>
        createDocument(client, tenantId, {
          name: name.trim(),
          description: description?.trim() || null,
          filename: filename.trim(),
          mimeType: mimeType.trim(),
          fileData: Buffer.from(fileDataBase64, "base64"),
        }),
      );
      return reply.code(201).send(document);
    },
  );

  app.delete<{ Params: { id: string } }>("/api/documents/:id", async (req, reply) => {
    const tenantId = req.dashboardUser!.tenantId;
    const deleted = await withTenant(tenantId, (client) => deleteDocument(client, req.params.id));
    if (!deleted) return reply.code(404).send({ error: "Document not found" });
    return { ok: true };
  });

  // --- WhatsApp message templates (live from Meta, see lib/whatsappTemplates.ts) ---

  // `wabaId: null` tells the dashboard to show a "not connected" state rather
  // than an error — templates belong to the WhatsApp Business Account, which
  // an admin sets per business on the admin page.
  app.get("/api/templates", async (req, reply) => {
    const tenant = await getTenantById(req.dashboardUser!.tenantId);
    const wabaId = tenant?.whatsappBusinessAccountId ?? null;
    if (!wabaId) return { wabaId: null, templates: [], reminderTemplateName: REMINDER_TEMPLATE_NAME };
    try {
      return { wabaId, templates: await listTemplates(wabaId), reminderTemplateName: REMINDER_TEMPLATE_NAME };
    } catch (err) {
      if (err instanceof MetaApiError) return reply.code(502).send({ error: `WhatsApp: ${err.message}` });
      throw err;
    }
  });

  app.post<{ Body: CreateTemplateInput }>("/api/templates", async (req, reply) => {
    const tenant = await getTenantById(req.dashboardUser!.tenantId);
    const wabaId = tenant?.whatsappBusinessAccountId;
    if (!wabaId) return reply.code(400).send({ error: "This business has no WhatsApp Business Account ID set yet" });
    const input = req.body;
    if (!input || !Array.isArray(input.components)) return reply.code(400).send({ error: "Invalid template" });
    const invalid = validateTemplateInput(input);
    if (invalid) return reply.code(400).send({ error: invalid });
    try {
      const created = await createTemplate(wabaId, {
        name: input.name,
        language: input.language,
        category: input.category,
        components: input.components,
      });
      return reply.code(201).send(created);
    } catch (err) {
      if (err instanceof MetaApiError) return reply.code(400).send({ error: `WhatsApp: ${err.message}` });
      throw err;
    }
  });

  app.delete<{ Params: { id: string }; Querystring: { name?: string } }>("/api/templates/:id", async (req, reply) => {
    const tenant = await getTenantById(req.dashboardUser!.tenantId);
    const wabaId = tenant?.whatsappBusinessAccountId;
    const name = req.query.name?.trim();
    if (!wabaId) return reply.code(400).send({ error: "This business has no WhatsApp Business Account ID set yet" });
    if (!name || !/^\d+$/.test(req.params.id)) return reply.code(400).send({ error: "Template id and name are required" });
    try {
      await deleteTemplate(wabaId, req.params.id, name);
      return { ok: true };
    } catch (err) {
      if (err instanceof MetaApiError) return reply.code(400).send({ error: `WhatsApp: ${err.message}` });
      throw err;
    }
  });
}
