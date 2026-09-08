"use server";

import { revalidatePath } from "next/cache";
import { backendFetch } from "@/lib/backend";

export async function createTenant(formData: FormData) {
  const businessName = String(formData.get("businessName") ?? "").trim();
  const businessDescription = String(formData.get("businessDescription") ?? "").trim();
  const whatsappPhoneNumberId = String(formData.get("whatsappPhoneNumberId") ?? "").trim();
  const whatsappBusinessAccountId = String(formData.get("whatsappBusinessAccountId") ?? "").trim();
  if (!businessName || !whatsappPhoneNumberId) return;

  await backendFetch("/api/admin/tenants", {
    method: "POST",
    body: JSON.stringify({ businessName, businessDescription, whatsappPhoneNumberId, whatsappBusinessAccountId }),
  });

  revalidatePath("/admin");
}

export async function updateWabaId(tenantId: string, formData: FormData) {
  const whatsappBusinessAccountId = String(formData.get("whatsappBusinessAccountId") ?? "").trim();
  if (!whatsappBusinessAccountId) return;

  await backendFetch(`/api/admin/tenants/${tenantId}/whatsapp-business-account`, {
    method: "POST",
    body: JSON.stringify({ whatsappBusinessAccountId }),
  });

  revalidatePath("/admin");
}

export async function linkClient(tenantId: string, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "owner").trim();
  if (!email) return;

  await backendFetch(`/api/admin/tenants/${tenantId}/link`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });

  revalidatePath("/admin");
}
