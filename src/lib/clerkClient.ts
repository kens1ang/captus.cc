import { createClerkClient } from "@clerk/backend";
import { config } from "./config.js";

const clerkClient = createClerkClient({ secretKey: config.clerk.secretKey });

/**
 * Admin-only helper (src/routes/admin.ts): resolves a client's email to their
 * Clerk user id, so an admin can link a tenant by email instead of needing
 * the client to dig up their raw Clerk user id (what link-user.ts required).
 * Returns null if nobody's signed up with that email yet — the client has to
 * sign up in Clerk first, then the admin links them.
 */
export async function findClerkUserIdByEmail(email: string): Promise<string | null> {
  const result = await clerkClient.users.getUserList({ emailAddress: [email] });
  return result.data[0]?.id ?? null;
}

/** The user's primary email, for self-serve signup (the session token itself doesn't carry it). */
export async function getClerkUserEmail(clerkUserId: string): Promise<string | null> {
  const user = await clerkClient.users.getUser(clerkUserId);
  const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ?? user.emailAddresses[0];
  return primary?.emailAddress ?? null;
}
