"use server";

import { revalidatePath } from "next/cache";
import { backendFetch } from "@/lib/backend";

export async function sendReply(conversationId: string, formData: FormData) {
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return;

  await backendFetch(`/api/conversations/${conversationId}/reply`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });

  revalidatePath(`/conversations/${conversationId}`);
  revalidatePath("/");
}

export async function resumeBot(conversationId: string) {
  await backendFetch(`/api/conversations/${conversationId}/resume`, { method: "POST" });
  revalidatePath(`/conversations/${conversationId}`);
  revalidatePath("/");
}
