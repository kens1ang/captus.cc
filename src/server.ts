import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./lib/config.js";
import { webhookRoutes } from "./routes/webhook.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { adminRoutes } from "./routes/admin.js";
import { googleAuthRoutes } from "./routes/googleAuth.js";
import { fileRoutes } from "./routes/files.js";
import { signupRoutes } from "./routes/signup.js";
import { testChatRoutes } from "./routes/testChat.js";
import { businessImportRoutes } from "./routes/businessImport.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

async function main() {
  // Default 1MB body limit is too small for document uploads (base64-encoded
  // in JSON — see routes/dashboard.ts's POST /api/documents), which inflates
  // a file's real size by ~33%. 15MB comfortably covers a typical menu/
  // catalog PDF or spreadsheet at SME scale.
  const app = Fastify({ logger: true, bodyLimit: 15 * 1024 * 1024 });

  // Keep the raw body around for HMAC signature verification, in addition to the parsed JSON.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    req.rawBody = body as Buffer;
    try {
      const json = body.length ? JSON.parse(body.toString("utf8")) : {};
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get("/health", async () => ({ ok: true }));

  // Only the dashboard's own origin may call the /api/* routes — the webhook
  // routes below aren't browser-called, so they don't need CORS at all.
  await app.register(cors, { origin: config.dashboardOrigin });

  await app.register(webhookRoutes);
  await app.register(signupRoutes);
  await app.register(dashboardRoutes);
  await app.register(testChatRoutes);
  await app.register(businessImportRoutes);
  await app.register(adminRoutes);
  await app.register(googleAuthRoutes);
  await app.register(fileRoutes);

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
