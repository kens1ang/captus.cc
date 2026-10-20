import type { FastifyInstance } from "fastify";
import { requireDashboardAuth } from "../lib/clerkAuth.js";
import {
  applyImport,
  dismissImport,
  getImportState,
  normalizeUrls,
  startImport,
  ImportRejectedError,
  IMPORT_PARTS,
  type ImportPart,
} from "../lib/businessImport.js";

// "Fill in my Knowledge from my website / social media" — see
// lib/businessImport.ts. Start → poll → review the draft → apply (or dismiss).
export async function businessImportRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireDashboardAuth);

  app.get("/api/import", async (req) => {
    return { import: await getImportState(req.dashboardUser!.tenantId) };
  });

  app.post<{ Body: { urls?: unknown } }>("/api/import", async (req, reply) => {
    let urls: string[];
    try {
      urls = normalizeUrls(req.body?.urls);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    try {
      return reply.code(202).send({ import: await startImport(req.dashboardUser!.tenantId, urls) });
    } catch (err) {
      if (err instanceof ImportRejectedError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  app.post<{ Body: { parts?: unknown } }>("/api/import/apply", async (req, reply) => {
    const parts = (Array.isArray(req.body?.parts) ? req.body.parts : []).filter((p): p is ImportPart => IMPORT_PARTS.includes(p as ImportPart));
    if (parts.length === 0) return reply.code(400).send({ error: "Choose at least one thing to add" });
    try {
      return { applied: await applyImport(req.dashboardUser!.tenantId, parts) };
    } catch (err) {
      if (err instanceof ImportRejectedError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  app.delete("/api/import", async (req, reply) => {
    await dismissImport(req.dashboardUser!.tenantId);
    return reply.code(204).send();
  });
}
