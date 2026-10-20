import type { FastifyInstance } from "fastify";
import { requireDashboardAuth } from "../lib/clerkAuth.js";
import { runTestChat, resetTestChat } from "../lib/testChat.js";

// Dashboard test chat — see lib/testChat.ts. Nothing here is sent to
// WhatsApp, booked for real, or stored in the inbox.
export async function testChatRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireDashboardAuth);

  app.post<{ Body: { messages?: unknown } }>("/api/test-chat", async (req, reply) => {
    const { tenantId, id: userId } = req.dashboardUser!;
    const result = await runTestChat(tenantId, userId, req.body?.messages);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    const { ok: _ok, ...body } = result;
    return body;
  });

  app.delete("/api/test-chat", async (req, reply) => {
    const { tenantId, id: userId } = req.dashboardUser!;
    await resetTestChat(tenantId, userId);
    return reply.code(204).send();
  });
}
