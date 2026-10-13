"use server";

import { revalidatePath } from "next/cache";
import { backendFetch } from "@/lib/backend";
import { attempt, fail, type ActionState } from "@/lib/actionState";

export async function createTenant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const businessName = String(formData.get("businessName") ?? "").trim();
  const businessDescription = String(formData.get("businessDescription") ?? "").trim();
  const whatsappPhoneNumberId = String(formData.get("whatsappPhoneNumberId") ?? "").trim();
  const whatsappBusinessAccountId = String(formData.get("whatsappBusinessAccountId") ?? "").trim();
  if (!businessName || !whatsappPhoneNumberId) return fail("Business name and phone number ID are required");

  return attempt(async () => {
    await backendFetch("/api/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ businessName, businessDescription, whatsappPhoneNumberId, whatsappBusinessAccountId }),
    });
    revalidatePath("/admin");
    return `Created "${businessName}"`;
  });
}

export async function updateWabaId(tenantId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const whatsappBusinessAccountId = String(formData.get("whatsappBusinessAccountId") ?? "").trim();
  if (!whatsappBusinessAccountId) return fail("Enter the WABA ID");

  return attempt(async () => {
    await backendFetch(`/api/admin/tenants/${tenantId}/whatsapp-business-account`, {
      method: "POST",
      body: JSON.stringify({ whatsappBusinessAccountId }),
    });
    revalidatePath("/admin");
  });
}

export async function linkClient(tenantId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "owner").trim();
  if (!email) return fail("Enter an email");

  return attempt(async () => {
    await backendFetch(`/api/admin/tenants/${tenantId}/link`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    });
    revalidatePath("/admin");
    return `Linked ${email}`;
  });
}
