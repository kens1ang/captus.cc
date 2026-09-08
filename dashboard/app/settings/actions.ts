"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { backendFetch } from "@/lib/backend";

export async function connectGoogleCalendar() {
  const { url } = await backendFetch<{ url: string }>("/api/google/connect");
  redirect(url);
}

export async function disconnectGoogleCalendar() {
  await backendFetch("/api/google/disconnect", { method: "POST" });
  revalidatePath("/settings");
}

export async function updateTimezone(formData: FormData) {
  const timezone = String(formData.get("timezone") ?? "").trim();
  if (!timezone) return;
  await backendFetch("/api/settings", { method: "PUT", body: JSON.stringify({ timezone }) });
  revalidatePath("/settings");
}

export async function addService(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const durationMinutes = Number(formData.get("durationMinutes"));
  if (!name || !Number.isFinite(durationMinutes) || durationMinutes <= 0) return;

  await backendFetch("/api/services", { method: "POST", body: JSON.stringify({ name, durationMinutes }) });
  revalidatePath("/settings");
}

export async function deleteServiceAction(serviceId: string) {
  await backendFetch(`/api/services/${serviceId}`, { method: "DELETE" });
  revalidatePath("/settings");
}

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** One open/close pair per day, read straight off the form's day-indexed field names — see page.tsx. */
export async function saveBusinessHours(formData: FormData) {
  const intervals: { dayOfWeek: number; startTime: string; endTime: string }[] = [];
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
    const day = DAY_NAMES[dayOfWeek];
    const closed = formData.get(`${day}_closed`) === "on";
    const startTime = String(formData.get(`${day}_start`) ?? "");
    const endTime = String(formData.get(`${day}_end`) ?? "");
    if (closed || !startTime || !endTime) continue;
    intervals.push({ dayOfWeek, startTime, endTime });
  }

  await backendFetch("/api/business-hours", { method: "PUT", body: JSON.stringify({ intervals }) });
  revalidatePath("/settings");
}
