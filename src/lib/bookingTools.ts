import { DateTime } from "luxon";
import type { Service } from "../db/services.js";
import type { ToolCall, ToolDeclaration } from "./gemini.js";
import { withTenant } from "../db/tenantContext.js";
import { computeAvailableSlots, isSlotAvailable } from "./availability.js";
import { createBooking } from "../db/bookings.js";
import { createCalendarEvent } from "./googleCalendar.js";

const CHECK_AVAILABILITY = "check_availability";
const BOOK_APPOINTMENT = "book_appointment";

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
  ];
}

function findService(services: Service[], name: string): Service | undefined {
  return services.find((s) => s.name.toLowerCase() === name.toLowerCase());
}

export interface BookingToolContext {
  tenantId: string;
  timezone: string;
  services: Service[];
  conversationId: string;
  contactWaNumber: string;
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
      slots: slots.map((s) => ({ start_iso: s.startISO, label: DateTime.fromISO(s.startISO).setZone(ctx.timezone).toFormat("EEE d LLL, h:mm a") })),
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

    return {
      success: true,
      booking_id: booking.id,
      confirmed_label: DateTime.fromISO(startISO).setZone(ctx.timezone).toFormat("EEE d LLL, h:mm a"),
    };
  }

  return { error: `Unknown tool "${call.name}"` };
}
