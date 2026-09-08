import { DateTime } from "luxon";
import { getServiceById, type Service } from "../db/services.js";
import type { ToolCall, ToolDeclaration } from "./gemini.js";
import { withTenant } from "../db/tenantContext.js";
import { computeAvailableSlots, isSlotAvailable } from "./availability.js";
import { createBooking, getBookingById, cancelBooking, listUpcomingBookingsForContact, type Booking } from "../db/bookings.js";
import { createCalendarEvent, deleteCalendarEvent } from "./googleCalendar.js";
import { scheduleReminder, cancelReminder } from "./bookingReminders.js";

const CHECK_AVAILABILITY = "check_availability";
const BOOK_APPOINTMENT = "book_appointment";
const LIST_MY_BOOKINGS = "list_my_bookings";
const CANCEL_APPOINTMENT = "cancel_appointment";
const RESCHEDULE_APPOINTMENT = "reschedule_appointment";

/** [] for a tenant with no services configured — the model then never sees these tools at all (worker.ts merges this into runReplyTurn's actionTools). */
export function buildBookingTools(services: Service[]): ToolDeclaration[] {
  if (services.length === 0) return [];
  const serviceNames = services.map((s) => s.name);

  return [
    {
      name: CHECK_AVAILABILITY,
      description:
        "Looks up real open appointment slots for a service. ALWAYS call this before offering or booking a time — never guess or invent availability yourself, and never assume a day is free just because you weren't shown otherwise.",
      parameters: {
        type: "OBJECT",
        properties: {
          service_name: { type: "STRING", description: "Exact service name the customer wants to book.", enum: serviceNames },
          date: {
            type: "STRING",
            description:
              "The specific date the customer wants, as YYYY-MM-DD in the business's own timezone — resolve relative wording ('tomorrow', 'next Tuesday') yourself using the current date/time given in your instructions. Omit only if the customer hasn't indicated any particular day, in which case you'll get the soonest few openings regardless of date.",
          },
        },
        required: ["service_name"],
      },
    },
    {
      name: BOOK_APPOINTMENT,
      description:
        "Books a specific slot for the customer. Only call this with a start_iso value that came from a check_availability result for the same service — never an invented or approximate time.",
      parameters: {
        type: "OBJECT",
        properties: {
          service_name: { type: "STRING", description: "Exact service name being booked.", enum: serviceNames },
          start_iso: { type: "STRING", description: "The exact start time (ISO 8601, with offset) from a prior check_availability result." },
          customer_name: { type: "STRING", description: "The customer's name, if they've given it in this conversation." },
        },
        required: ["service_name", "start_iso"],
      },
    },
    {
      name: LIST_MY_BOOKINGS,
      description:
        "Lists this customer's own upcoming confirmed bookings (with their booking_id). Call this before cancel_appointment or reschedule_appointment whenever it's not already 100% clear which booking the customer means — e.g. they have more than one, or haven't specified which.",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: CANCEL_APPOINTMENT,
      description: "Cancels one of this customer's own bookings. Use list_my_bookings first if you're not certain which booking_id is the right one.",
      parameters: {
        type: "OBJECT",
        properties: {
          booking_id: { type: "STRING", description: "The booking's id, from a list_my_bookings or earlier book_appointment result." },
        },
        required: ["booking_id"],
      },
    },
    {
      name: RESCHEDULE_APPOINTMENT,
      description:
        "Moves an existing booking to a new time (cancels the old slot and books the new one as one action). Only call this with a new_start_iso that came from a check_availability result — check availability for the new time first. If the new time isn't actually available, the old booking is left untouched.",
      parameters: {
        type: "OBJECT",
        properties: {
          booking_id: { type: "STRING", description: "The existing booking's id, from a list_my_bookings or earlier book_appointment result." },
          new_start_iso: { type: "STRING", description: "The new start time (ISO 8601, with offset) from a check_availability result — same service/duration as the existing booking." },
        },
        required: ["booking_id", "new_start_iso"],
      },
    },
  ];
}

function findService(services: Service[], name: string): Service | undefined {
  return services.find((s) => s.name.toLowerCase() === name.toLowerCase());
}

// Full start–end range, not just the start time — a customer told only
// "2:30 PM" has no idea if that means they need to block 15 minutes or an
// hour of their day.
function label(startISO: string, endISO: string, timezone: string): string {
  const start = DateTime.fromISO(startISO).setZone(timezone);
  const end = DateTime.fromISO(endISO).setZone(timezone);
  return `${start.toFormat("EEE d LLL")}, ${start.toFormat("h:mm a")} - ${end.toFormat("h:mm a")}`;
}

export interface BookingToolContext {
  tenantId: string;
  timezone: string;
  services: Service[];
  conversationId: string;
  contactWaNumber: string;
}

/** Shared by book_appointment and reschedule_appointment's new-slot leg — assumes the caller already re-validated availability. */
async function createConfirmedBooking(
  ctx: BookingToolContext,
  service: Service,
  startISO: string,
  customerName: string | null,
): Promise<Booking> {
  const endISO = DateTime.fromISO(startISO).plus({ minutes: service.durationMinutes }).toISO()!;
  const googleEventId = await createCalendarEvent(ctx.tenantId, {
    summary: `${service.name} — ${customerName ?? ctx.contactWaNumber}`,
    description: `Booked via Captus WhatsApp. Customer: ${ctx.contactWaNumber}${customerName ? ` (${customerName})` : ""}.`,
    startISO,
    endISO,
    timezone: ctx.timezone,
  });
  const booking = await withTenant(ctx.tenantId, (client) =>
    createBooking(client, ctx.tenantId, {
      conversationId: ctx.conversationId,
      serviceId: service.id,
      contactWaNumber: ctx.contactWaNumber,
      contactName: customerName,
      startsAt: startISO,
      endsAt: endISO,
      googleEventId,
    }),
  );
  await scheduleReminder(ctx.tenantId, booking.id, startISO);
  return booking;
}

/**
 * Looks up a booking and verifies it actually belongs to this conversation's
 * customer — booking_id is an LLM-supplied tool argument, driven by
 * attacker-controllable conversation text, so this check is what actually
 * stops one customer's messages from cancelling or rescheduling someone
 * else's booking (a guessed or leaked id), not just trusting the model to
 * only ever reference its own list_my_bookings results.
 */
async function getOwnBooking(ctx: BookingToolContext, bookingId: string): Promise<Booking | null> {
  const booking = await withTenant(ctx.tenantId, (client) => getBookingById(client, bookingId));
  if (!booking || booking.status !== "confirmed" || booking.contactWaNumber !== ctx.contactWaNumber) return null;
  return booking;
}

/** Dispatches a single tool call from the reply agent loop — the only place booking tool names/args are actually executed against real data. */
export async function executeBookingTool(ctx: BookingToolContext, call: ToolCall): Promise<unknown> {
  if (call.name === CHECK_AVAILABILITY) {
    const serviceName = call.args.service_name as string | undefined;
    const service = serviceName ? findService(ctx.services, serviceName) : undefined;
    if (!service) return { error: `Unknown service "${serviceName}". Valid services: ${ctx.services.map((s) => s.name).join(", ")}` };

    const date = call.args.date as string | undefined;
    const slots = await withTenant(ctx.tenantId, (client) => computeAvailableSlots(client, ctx.tenantId, ctx.timezone, service.durationMinutes, date));
    return {
      service: service.name,
      duration_minutes: service.durationMinutes,
      searched_date: date ?? null,
      // Both a machine-usable ISO value (to echo back in book_appointment) and
      // a human label in the tenant's own timezone, so the model doesn't have
      // to do its own timezone math when describing options to the customer.
      // If these slots fall on a different date than requested, the label
      // makes that obvious — say so rather than booking the wrong day.
      slots: slots.map((s) => ({ start_iso: s.startISO, label: label(s.startISO, s.endISO, ctx.timezone) })),
    };
  }

  if (call.name === BOOK_APPOINTMENT) {
    const serviceName = call.args.service_name as string | undefined;
    const startISO = call.args.start_iso as string | undefined;
    const customerName = (call.args.customer_name as string | undefined) ?? null;
    const service = serviceName ? findService(ctx.services, serviceName) : undefined;
    if (!service) return { success: false, error: `Unknown service "${serviceName}".` };
    if (!startISO || !DateTime.fromISO(startISO).isValid) {
      return { success: false, error: "start_iso is missing or not a valid ISO timestamp." };
    }

    // Re-validate against real data at the moment of booking — never trust
    // that a slot offered a message or two ago is still open (another
    // customer, or a new calendar event, could have taken it since).
    const stillAvailable = await withTenant(ctx.tenantId, (client) =>
      isSlotAvailable(client, ctx.tenantId, ctx.timezone, service.durationMinutes, startISO),
    );
    if (!stillAvailable) {
      return { success: false, error: "That slot is no longer available — call check_availability again for current options." };
    }

    const booking = await createConfirmedBooking(ctx, service, startISO, customerName);
    return { success: true, booking_id: booking.id, confirmed_label: label(booking.startsAt, booking.endsAt, ctx.timezone) };
  }

  if (call.name === LIST_MY_BOOKINGS) {
    const bookings = await withTenant(ctx.tenantId, (client) => listUpcomingBookingsForContact(client, ctx.contactWaNumber));
    return {
      bookings: bookings.map((b) => ({ booking_id: b.id, service: b.serviceName, label: label(b.startsAt, b.endsAt, ctx.timezone) })),
    };
  }

  if (call.name === CANCEL_APPOINTMENT) {
    const bookingId = call.args.booking_id as string | undefined;
    const booking = bookingId ? await getOwnBooking(ctx, bookingId) : null;
    if (!booking) return { success: false, error: "No matching upcoming booking found for this customer — call list_my_bookings to check." };

    const cancelled = await withTenant(ctx.tenantId, (client) => cancelBooking(client, booking.id));
    if (!cancelled) return { success: false, error: "That booking was already cancelled." };
    await cancelReminder(cancelled.id);
    if (cancelled.googleEventId) {
      try {
        await deleteCalendarEvent(ctx.tenantId, cancelled.googleEventId);
      } catch (err) {
        console.warn(`[bookingTools] failed to delete Google Calendar event for cancelled booking ${cancelled.id}:`, err);
      }
    }
    return { success: true, cancelled_label: label(cancelled.startsAt, cancelled.endsAt, ctx.timezone) };
  }

  if (call.name === RESCHEDULE_APPOINTMENT) {
    const bookingId = call.args.booking_id as string | undefined;
    const newStartISO = call.args.new_start_iso as string | undefined;
    const existing = bookingId ? await getOwnBooking(ctx, bookingId) : null;
    if (!existing) return { success: false, error: "No matching upcoming booking found for this customer — call list_my_bookings to check." };
    if (!newStartISO || !DateTime.fromISO(newStartISO).isValid) {
      return { success: false, error: "new_start_iso is missing or not a valid ISO timestamp." };
    }
    const service = existing.serviceId ? await withTenant(ctx.tenantId, (client) => getServiceById(client, existing.serviceId!)) : null;
    if (!service) return { success: false, error: "The original service for this booking no longer exists — please book a new appointment instead." };

    // Validate the NEW slot before touching the old booking at all — if the
    // new time turns out unavailable, the customer keeps their existing
    // booking rather than ending up with neither (see reschedule_appointment's
    // tool description: "the old booking is left untouched" is a real
    // guarantee, not just a hope).
    const stillAvailable = await withTenant(ctx.tenantId, (client) =>
      isSlotAvailable(client, ctx.tenantId, ctx.timezone, service.durationMinutes, newStartISO),
    );
    if (!stillAvailable) {
      return { success: false, error: "That new time isn't available — call check_availability again and the existing booking is unchanged." };
    }

    const cancelled = await withTenant(ctx.tenantId, (client) => cancelBooking(client, existing.id));
    if (cancelled) await cancelReminder(cancelled.id);
    if (cancelled?.googleEventId) {
      try {
        await deleteCalendarEvent(ctx.tenantId, cancelled.googleEventId);
      } catch (err) {
        console.warn(`[bookingTools] failed to delete Google Calendar event for rescheduled booking ${cancelled.id}:`, err);
      }
    }
    const rebooked = await createConfirmedBooking(ctx, service, newStartISO, existing.contactName);
    return {
      success: true,
      old_label: label(existing.startsAt, existing.endsAt, ctx.timezone),
      new_booking_id: rebooked.id,
      new_label: label(rebooked.startsAt, rebooked.endsAt, ctx.timezone),
    };
  }

  return { error: `Unknown tool "${call.name}"` };
}
