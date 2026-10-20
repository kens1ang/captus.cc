import type { FastifyInstance } from "fastify";
import { IANAZone } from "luxon";
import { verifyClerkSession } from "../lib/clerkAuth.js";
import { getClerkUserEmail } from "../lib/clerkClient.js";
import { getUserByClerkId, createTenantForNewUser } from "../db/users.js";

// Self-serve signup: someone signs up with an email (Clerk), names their
// business, and gets their own tenant straight away — no WhatsApp number
// yet. They can fill in knowledge, set up bookings and try the assistant in
// the dashboard's test chat; the number is connected later. Before this, a
// new signup sat on "ask your Captus contact to link you" until an admin
// ran link-user by hand.
export async function signupRoutes(app: FastifyInstance) {
  app.post<{ Body: { businessName?: string; timezone?: string } }>("/api/signup", async (req, reply) => {
    const clerkUserId = await verifyClerkSession(req, reply);
    if (!clerkUserId) return reply;

    const businessName = req.body?.businessName?.trim();
    if (!businessName) return reply.code(400).send({ error: "businessName is required" });
    if (businessName.length > 120) return reply.code(400).send({ error: "businessName is too long" });
    // The browser's own zone, so booking times are right from the start
    // (editable later in Settings). Anything Luxon doesn't recognise falls
    // back to the column default rather than failing the signup.
    const tz = req.body?.timezone;
    const timezone = tz && IANAZone.isValidZone(tz) ? tz : undefined;

    if (await getUserByClerkId(clerkUserId)) {
      return reply.code(409).send({ error: "This account already has a business" });
    }
    const email = await getClerkUserEmail(clerkUserId);
    if (!email) return reply.code(400).send({ error: "This account has no email address" });

    const created = await createTenantForNewUser({ clerkUserId, email, businessName, timezone });
    if (!created) return reply.code(409).send({ error: "This account already has a business" });
    return reply.code(201).send(created);
  });
}
