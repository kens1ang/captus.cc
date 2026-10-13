"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { backendFetch } from "@/lib/backend";
import { attempt, fail, type ActionState } from "@/lib/actionState";

export async function connectGoogleCalendar() {
  const { url } = await backendFetch<{ url: string }>("/api/google/connect");
  redirect(url);
}

export async function disconnectGoogleCalendar() {
  await backendFetch("/api/google/disconnect", { method: "POST" });
  revalidatePath("/", "layout");
}

export async function updateTimezone(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const timezone = String(formData.get("timezone") ?? "").trim();
  if (!timezone) return fail("Choose a timezone");
  return attempt(async () => {
    await backendFetch("/api/settings", { method: "PUT", body: JSON.stringify({ timezone }) });
    revalidatePath("/", "layout");
  });
}
