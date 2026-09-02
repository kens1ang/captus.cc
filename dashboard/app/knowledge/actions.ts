"use server";

import { revalidatePath } from "next/cache";
import { backendFetch } from "@/lib/backend";

export async function addKnowledge(formData: FormData) {
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return;

  await backendFetch("/api/knowledge", {
    method: "POST",
    body: JSON.stringify({ text, source: "dashboard" }),
  });

  revalidatePath("/knowledge");
}

export async function deleteKnowledge(chunkId: string) {
  await backendFetch(`/api/knowledge/${chunkId}`, { method: "DELETE" });
  revalidatePath("/knowledge");
}
