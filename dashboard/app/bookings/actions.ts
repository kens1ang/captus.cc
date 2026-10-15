"use server";

import { revalidatePath } from "next/cache";
import { backendFetch } from "@/lib/backend";
import { attempt, fail, type ActionState } from "@/lib/actionState";

export async function cancelBookingAction(bookingId: string) {
  await backendFetch(`/api/bookings/${bookingId}/cancel`, { method: "POST" });
  revalidatePath("/", "layout");
}

function readServiceFields(formData: FormData): { durationMinutes: number; capacity: number } | string {
  const durationMinutes = Number(formData.get("durationMinutes"));
  const capacity = Number(formData.get("capacity") ?? 1);
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) return "Duration must be a positive number of minutes";
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) return "Bookings at a time must be a whole number from 1 to 100";
  return { durationMinutes, capacity };
}

export async function addService(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return fail("Give the service a name");
  const fields = readServiceFields(formData);
  if (typeof fields === "string") return fail(fields);

  return attempt(async () => {
    await backendFetch("/api/services", { method: "POST", body: JSON.stringify({ name, ...fields }) });
    revalidatePath("/", "layout");
    return `Added "${name}"`;
  });
}

export async function updateServiceAction(serviceId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const fields = readServiceFields(formData);
  if (typeof fields === "string") return fail(fields);

  return attempt(async () => {
    await backendFetch(`/api/services/${serviceId}`, { method: "PATCH", body: JSON.stringify(fields) });
    revalidatePath("/", "layout");
    return "Saved";
  });
}

export async function deleteServiceAction(serviceId: string) {
  await backendFetch(`/api/services/${serviceId}`, { method: "DELETE" });
  revalidatePath("/", "layout");
}
