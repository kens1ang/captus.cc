"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { backendFetch } from "@/lib/backend";
import { attempt, fail, type ActionState } from "@/lib/actionState";

/** Self-serve signup: creates this login's own business (no WhatsApp number yet), then drops them into Knowledge. */
export async function createBusiness(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const businessName = String(formData.get("businessName") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  const urls = String(formData.get("urls") ?? "")
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter(Boolean);
  if (!businessName) return fail("Enter your business name");

  let importStarted = false;
  const result = await attempt(async () => {
    const res = await backendFetch<{ importStarted?: boolean }>("/api/signup", { method: "POST", body: JSON.stringify({ businessName, timezone, urls }) });
    importStarted = !!res.importStarted;
  });
  if (!result?.ok) return result;
  // The root layout is what showed the "create your business" screen, and a
  // redirect alone reuses it as-is — re-render it so the app shell appears.
  revalidatePath("/", "layout");
  // With links, the Knowledge overview shows the import running; without, start on the profile.
  redirect(importStarted ? "/knowledge" : "/knowledge/profile");
}
