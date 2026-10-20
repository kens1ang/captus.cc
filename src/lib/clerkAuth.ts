import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyToken } from "@clerk/backend";
import { config } from "./config.js";
import { getUserByClerkId, type DashboardUser } from "../db/users.js";

declare module "fastify" {
  interface FastifyRequest {
    dashboardUser?: DashboardUser;
  }
}

/**
 * Verifies the Clerk session token (`Authorization: Bearer <token>`) and
 * returns the Clerk user id — or replies 401 and returns null. Doesn't
 * require a linked tenant: self-serve signup (routes/signup.ts) uses this
 * directly, since creating that tenant is the whole point of the call.
 */
export async function verifyClerkSession(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing bearer token" });
    return null;
  }
  const token = authHeader.slice("Bearer ".length);
  try {
    const verified = await verifyToken(token, { secretKey: config.clerk.secretKey });
    return verified.sub;
  } catch (err) {
    req.log.warn({ err }, "Clerk token verification failed");
    reply.code(401).send({ error: "Invalid session" });
    return null;
  }
}

/**
 * Fastify preHandler for dashboard API routes: verifies the Clerk session
 * token (sent as `Authorization: Bearer <token>` by the Next.js dashboard),
 * then resolves it to one of our own tenants via db/users.ts. Attaches the
 * result as req.dashboardUser, or replies 401 and stops the request.
 */
export async function requireDashboardAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const clerkUserId = await verifyClerkSession(req, reply);
  if (!clerkUserId) return reply;

  const user = await getUserByClerkId(clerkUserId);
  if (!user) {
    reply.code(403).send({ error: "This account isn't linked to a tenant yet" });
    return reply;
  }

  req.dashboardUser = user;
}

/**
 * Fastify preHandler for the platform-admin API (src/routes/admin.ts) — chain
 * AFTER requireDashboardAuth, which already resolved req.dashboardUser.
 * Rejects anyone whose users row doesn't have is_admin set.
 */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.dashboardUser?.isAdmin) {
    reply.code(403).send({ error: "Admin access required" });
    return reply;
  }
}
