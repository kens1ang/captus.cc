"use server";

import { revalidatePath } from "next/cache";
import { backendFetch } from "@/lib/backend";

export async function uploadDocument(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const file = formData.get("file") as File | null;
  if (!name || !file || file.size === 0) return;

  const fileDataBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  await backendFetch("/api/documents", {
    method: "POST",
    body: JSON.stringify({
      name,
      description,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      fileDataBase64,
    }),
  });

  revalidatePath("/documents");
}

export async function deleteDocumentAction(documentId: string) {
  await backendFetch(`/api/documents/${documentId}`, { method: "DELETE" });
  revalidatePath("/documents");
}
