"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { backendFetch } from "@/lib/backend";
import { attempt, fail, type ActionState } from "@/lib/actionState";

export async function createTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return fail("Something went wrong reading the form — please try again");
  }

  const result = await attempt(async () => {
    await backendFetch("/api/templates", { method: "POST", body: JSON.stringify(payload) });
  });
  if (!result?.ok) return result;

  revalidatePath("/templates");
  redirect("/templates?created=1");
}

export async function deleteTemplateAction(templateId: string, name: string) {
  await backendFetch(`/api/templates/${templateId}?name=${encodeURIComponent(name)}`, { method: "DELETE" });
  revalidatePath("/templates");
}
