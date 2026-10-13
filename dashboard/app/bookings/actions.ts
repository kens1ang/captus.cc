"use server";

import { revalidatePath } from "next/cache";
import { backendFetch } from "@/lib/backend";
import { attempt, fail, type ActionState } from "@/lib/actionState";

export async function cancelBookingAction(bookingId: string) {
  await backendFetch(`/api/bookings/${bookingId}/cancel`, { method: "POST" });
  revalidatePath("/", "layout");
}

export async function addService(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const durationMinutes = Number(formData.get("durationMinutes"));
  if (!name) return fail("Give the service a name");
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return fail("Duration must be a positive number of minutes");

  return attempt(async () => {
    await backendFetch("/api/services", { method: "POST", body: JSON.stringify({ name, durationMinutes }) });
    revalidatePath("/", "layout");
    return `Added "${name}"`;
  });
}

export async function deleteServiceAction(serviceId: string) {
  await backendFetch(`/api/services/${serviceId}`, { method: "DELETE" });
  revalidatePath("/", "layout");
}
