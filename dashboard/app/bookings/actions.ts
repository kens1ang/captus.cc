"use server";

import { revalidatePath } from "next/cache";
import { backendFetch } from "@/lib/backend";

export async function cancelBookingAction(bookingId: string) {
  await backendFetch(`/api/bookings/${bookingId}/cancel`, { method: "POST" });
  revalidatePath("/bookings");
}
