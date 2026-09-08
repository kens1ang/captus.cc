import type { FastifyInstance } from "fastify";
import { withTenant } from "../db/tenantContext.js";
import { getDocumentFile } from "../db/documents.js";

// Public, unauthenticated on purpose — this is the link WhatsApp's own
// servers fetch a document from when the bot sends one (lib/documentTools.ts),
// not something a logged-in dashboard user hits. Correctness/isolation still
// comes from RLS: the tenantId in the URL is what scopes the query, and a
// document id is a random UUID, not something else's id could collide with.
export async function fileRoutes(app: FastifyInstance) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  app.get<{ Params: { tenantId: string; documentId: string } }>("/files/:tenantId/:documentId", async (req, reply) => {
    const { tenantId, documentId } = req.params;
    // Malformed ids would otherwise surface as an ugly Postgres cast error
    // (app.tenant_id::uuid) rather than a clean 404.
    if (!UUID_RE.test(tenantId) || !UUID_RE.test(documentId)) {
      return reply.code(404).send({ error: "Not found" });
    }
    const file = await withTenant(tenantId, (client) => getDocumentFile(client, documentId));
    if (!file) return reply.code(404).send({ error: "Not found" });

    return reply
      .header("Content-Type", file.mimeType)
      .header("Content-Disposition", `attachment; filename="${file.filename.replace(/"/g, "")}"`)
      .send(file.fileData);
  });
}
