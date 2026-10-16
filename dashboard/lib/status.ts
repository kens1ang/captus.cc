import type { ConversationStatus } from "./data";

// Lives outside lib/data.ts so client components can use it: data.ts pulls
// in Clerk's server-only auth, and importing anything from it into a client
// component breaks the production build.

/** "Needs you" covers both: handed over (assistant paused) and flagged (assistant still replying, owner should follow up). */
export function needsAttention(status: ConversationStatus): boolean {
  return status === "needs_human" || status === "flagged";
}
