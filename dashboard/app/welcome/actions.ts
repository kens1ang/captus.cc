"use server";

import { redirect } from "next/navigation";
import { backendFetch } from "@/lib/backend";
import { attempt, fail, type ActionState } from "@/lib/actionState";

/** Self-serve signup: creates this login's own business (no WhatsApp number yet), then drops them into Knowledge. */
export async function createBusiness(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const businessName = String(formData.get("businessName") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  if (!businessName) return fail("Enter your business name");

  const result = await attempt(async () => {
    await backendFetch("/api/signup", { method: "POST", body: JSON.stringify({ businessName, timezone }) });
  });
  if (!result?.ok) return result;
  redirect("/knowledge/profile");
}
