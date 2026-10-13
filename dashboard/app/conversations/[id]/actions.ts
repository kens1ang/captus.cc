"use server";

import { revalidatePath } from "next/cache";
import { backendFetch } from "@/lib/backend";
import { attempt, type ActionState } from "@/lib/actionState";

export async function sendReply(conversationId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return null;

  const result = await attempt(async () => {
    await backendFetch(`/api/conversations/${conversationId}/reply`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    return "Sent";
  });
  revalidatePath("/conversations", "layout");
  return result;
}

export async function resumeBot(conversationId: string) {
  await backendFetch(`/api/conversations/${conversationId}/resume`, { method: "POST" });
  revalidatePath("/conversations", "layout");
}
