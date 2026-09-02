import type { FastifyInstance } from "fastify";
import { requireDashboardAuth, requireAdmin } from "../lib/clerkAuth.js";
import { createTenant, listTenants, getTenantById } from "../db/tenants.js";
import { linkUserToTenant, listUsersForTenant } from "../db/users.js";
import { findClerkUserIdByEmail } from "../lib/clerkClient.js";

// Platform-admin API: onboard new client tenants and link a client's Clerk
// account to one, from the dashboard itself instead of the CLI scripts
// (onboard-tenant.ts / link-user.ts). Gated to users with is_admin — see
// lib/clerkAuth.ts. Deliberately separate from dashboard.ts's tenant-scoped
// routes rather than folding admin-ness into them: clients' own view (one
// tenant, via req.dashboardUser.tenantId) stays exactly as it was.
export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireDashboardAuth);
  app.addHook("preHandler", requireAdmin);

  app.get("/api/admin/tenants", async () => {
    const tenants = await listTenants();
    const withUsers = await Promise.all(
      tenants.map(async (tenant) => ({ ...tenant, users: await listUsersForTenant(tenant.id) })),
    );
    return withUsers;
  });

  app.post<{
    Body: { businessName: string; businessDescription?: string; whatsappPhoneNumberId: string };
  }>("/api/admin/tenants", async (req, reply) => {
    const { businessName, businessDescription, whatsappPhoneNumberId } = req.body ?? ({} as never);
    if (!businessName?.trim() || !whatsappPhoneNumberId?.trim()) {
      return reply.code(400).send({ error: "businessName and whatsappPhoneNumberId are required" });
    }
    const tenant = await createTenant({
      businessName: businessName.trim(),
      businessDescription: businessDescription?.trim() ?? "",
      whatsappPhoneNumberId: whatsappPhoneNumberId.trim(),
    });
    return reply.code(201).send(tenant);
  });

  app.get<{ Params: { id: string } }>("/api/admin/tenants/:id", async (req, reply) => {
    const tenant = await getTenantById(req.params.id);
    if (!tenant) return reply.code(404).send({ error: "Tenant not found" });
    const users = await listUsersForTenant(tenant.id);
    return { ...tenant, users };
  });

  // Links a client's Clerk account (found by email — they must have already
  // signed up in Clerk) to this tenant. Same effect as `npm run link-user`,
  // callable from the dashboard.
  app.post<{ Params: { id: string }; Body: { email: string; role?: string } }>(
    "/api/admin/tenants/:id/link",
    async (req, reply) => {
      const email = req.body?.email?.trim();
      if (!email) return reply.code(400).send({ error: "email is required" });

      const tenant = await getTenantById(req.params.id);
      if (!tenant) return reply.code(404).send({ error: "Tenant not found" });

      const clerkUserId = await findClerkUserIdByEmail(email);
      if (!clerkUserId) {
        return reply.code(404).send({
          error: `No Clerk account found for ${email} yet — have them sign up at the dashboard's sign-up page first, then link again.`,
        });
      }

      const user = await linkUserToTenant({ clerkUserId, email, tenantId: tenant.id, role: req.body.role });
      return reply.code(201).send(user);
    },
  );
}
