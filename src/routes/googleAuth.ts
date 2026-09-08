import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { config } from "../lib/config.js";
import { requireDashboardAuth } from "../lib/clerkAuth.js";
import { signState, verifySignedState } from "../lib/crypto.js";
import { withTenant } from "../db/tenantContext.js";
import { getGoogleCalendarConnection, saveGoogleCalendarConnection, deleteGoogleCalendarConnection } from "../db/googleCalendarConnections.js";
import { buildGoogleAuthUrl, exchangeCodeForTokens, getPrimaryCalendarEmail, revokeGoogleToken } from "../lib/googleCalendar.js";

// Stage 5: per-tenant "connect your Google Calendar" OAuth flow. /connect and
// /status/disconnect are dashboard-authed (need to know which tenant); /callback
// is NOT — it's Google's own server redirecting the owner's browser back to
// us with a one-time code, and it identifies the tenant via the signed
// `state` param instead (routes/googleAuth.ts is the one place that pattern
// is needed — every other tenant-scoped route gets tenantId from the dashboard session).
export async function googleAuthRoutes(app: FastifyInstance) {
  app.get("/api/google/connect", { preHandler: requireDashboardAuth }, async (req) => {
    const tenantId = req.dashboardUser!.tenantId;
    const state = signState(`${tenantId}:${crypto.randomUUID()}`);
    return { url: buildGoogleAuthUrl(state) };
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/api/google/callback", async (req, reply) => {
    const { code, state, error } = req.query;
    const dashboardUrl = config.dashboardOrigin;

    if (error || !code || !state) {
      req.log.warn({ error }, "Google OAuth callback missing code/state or denied");
      return reply.redirect(`${dashboardUrl}/settings?google=error`);
    }

    const payload = verifySignedState(state);
    const tenantId = payload?.split(":")[0];
    if (!tenantId) {
      req.log.warn("Google OAuth callback got an invalid/tampered state param");
      return reply.redirect(`${dashboardUrl}/settings?google=error`);
    }

    try {
      const { accessToken, refreshToken } = await exchangeCodeForTokens(code);
      const connectedEmail = await getPrimaryCalendarEmail(accessToken);
      await withTenant(tenantId, (client) => saveGoogleCalendarConnection(client, tenantId, refreshToken, connectedEmail));
      return reply.redirect(`${dashboardUrl}/settings?google=connected`);
    } catch (err) {
      req.log.error({ err }, "Google OAuth token exchange failed");
      return reply.redirect(`${dashboardUrl}/settings?google=error`);
    }
  });

  app.get("/api/google/status", { preHandler: requireDashboardAuth }, async (req) => {
    const tenantId = req.dashboardUser!.tenantId;
    const connection = await withTenant(tenantId, (client) => getGoogleCalendarConnection(client));
    return { connected: connection !== null, connectedEmail: connection?.connectedEmail ?? null };
  });

  app.post("/api/google/disconnect", { preHandler: requireDashboardAuth }, async (req) => {
    const tenantId = req.dashboardUser!.tenantId;
    const connection = await withTenant(tenantId, (client) => getGoogleCalendarConnection(client));
    if (connection) {
      await revokeGoogleToken(connection.refreshToken);
      await withTenant(tenantId, (client) => deleteGoogleCalendarConnection(client));
    }
    return { ok: true };
  });
}
