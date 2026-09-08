import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./lib/config.js";
import { webhookRoutes } from "./routes/webhook.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { adminRoutes } from "./routes/admin.js";
import { googleAuthRoutes } from "./routes/googleAuth.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

async function main() {
  const app = Fastify({ logger: true });

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
  await app.register(dashboardRoutes);
  await app.register(adminRoutes);
  await app.register(googleAuthRoutes);

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
