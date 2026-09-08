import { DateTime } from "luxon";
import type { PoolClient } from "pg";
import { listBusinessHours } from "../db/businessHours.js";
import { listConfirmedBookingsInRange } from "../db/bookings.js";
import { queryFreeBusy } from "./googleCalendar.js";

export interface AvailableSlot {
  startISO: string;
  endISO: string;
}

const SLOT_GRID_MINUTES = 30; // candidate start times are on a 30-minute grid
const MIN_LEAD_TIME_MINUTES = 30; // can't book something starting in the next 30 minutes
const SEARCH_DAYS_AHEAD = 14;
const MAX_SLOTS_RETURNED = 8;

function overlaps(aStart: DateTime, aEnd: DateTime, bStartISO: string, bEndISO: string): boolean {
  const bStart = DateTime.fromISO(bStartISO);
  const bEnd = DateTime.fromISO(bEndISO);
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Real, deterministic availability — never something the LLM invents. Walks
 * the tenant's weekly business hours on a 30-minute grid over the next two
 * weeks, filtering out anything that overlaps either a locally-confirmed
 * booking or a busy block on the tenant's actual Google Calendar (meetings,
 * holidays, anything not made through Captus). If the tenant hasn't
 * connected a calendar, queryFreeBusy just returns [] and this still works
 * off local bookings alone.
 */
export async function computeAvailableSlots(
  client: PoolClient,
  tenantId: string,
  timezone: string,
  durationMinutes: number,
): Promise<AvailableSlot[]> {
  const hours = await listBusinessHours(client);
  if (hours.length === 0) return [];

  const now = DateTime.now().setZone(timezone);
  const rangeStart = now;
  const rangeEnd = now.plus({ days: SEARCH_DAYS_AHEAD });

  const [localBookings, busyBlocks] = await Promise.all([
    listConfirmedBookingsInRange(client, rangeStart.toISO()!, rangeEnd.toISO()!),
    queryFreeBusy(tenantId, rangeStart.toISO()!, rangeEnd.toISO()!),
  ]);

  const earliestStart = now.plus({ minutes: MIN_LEAD_TIME_MINUTES });
  const slots: AvailableSlot[] = [];

  for (let dayOffset = 0; dayOffset < SEARCH_DAYS_AHEAD && slots.length < MAX_SLOTS_RETURNED; dayOffset++) {
    const day = now.plus({ days: dayOffset }).startOf("day");
    const dayOfWeek = day.weekday % 7; // luxon: 1=Mon..7=Sun -> 0=Sun..6=Sat, matching schema
    const dayIntervals = hours.filter((h) => h.dayOfWeek === dayOfWeek);

    for (const interval of dayIntervals) {
      const [startH, startM] = interval.startTime.split(":").map(Number);
      const [endH, endM] = interval.endTime.split(":").map(Number);
      const intervalStart = day.set({ hour: startH, minute: startM });
      const intervalEnd = day.set({ hour: endH, minute: endM });

      for (let slotStart = intervalStart; slotStart.plus({ minutes: durationMinutes }) <= intervalEnd; slotStart = slotStart.plus({ minutes: SLOT_GRID_MINUTES })) {
        if (slots.length >= MAX_SLOTS_RETURNED) break;
        if (slotStart < earliestStart) continue;

        const slotEnd = slotStart.plus({ minutes: durationMinutes });
        const clashesLocally = localBookings.some((b) => overlaps(slotStart, slotEnd, b.startsAt, b.endsAt));
        const clashesOnCalendar = busyBlocks.some((b) => overlaps(slotStart, slotEnd, b.start, b.end));
        if (clashesLocally || clashesOnCalendar) continue;

        slots.push({ startISO: slotStart.toISO()!, endISO: slotEnd.toISO()! });
      }
    }
  }

  return slots;
}

/**
 * Re-validates one specific slot at the moment of booking — the tool-calling
 * loop's last line of defense against booking a time the model merely
 * remembers from an earlier check_availability call, which could have been
 * taken by someone else (or fallen outside hours/lead-time) since then.
 */
export async function isSlotAvailable(
  client: PoolClient,
  tenantId: string,
  timezone: string,
  durationMinutes: number,
  startISO: string,
): Promise<boolean> {
  const slotStart = DateTime.fromISO(startISO).setZone(timezone);
  const slotEnd = slotStart.plus({ minutes: durationMinutes });
  const now = DateTime.now().setZone(timezone);
  if (slotStart < now.plus({ minutes: MIN_LEAD_TIME_MINUTES })) return false;

  const hours = await listBusinessHours(client);
  const dayOfWeek = slotStart.weekday % 7;
  const withinHours = hours.some((h) => {
    if (h.dayOfWeek !== dayOfWeek) return false;
    const [startH, startM] = h.startTime.split(":").map(Number);
    const [endH, endM] = h.endTime.split(":").map(Number);
    const intervalStart = slotStart.startOf("day").set({ hour: startH, minute: startM });
    const intervalEnd = slotStart.startOf("day").set({ hour: endH, minute: endM });
    return slotStart >= intervalStart && slotEnd <= intervalEnd;
  });
  if (!withinHours) return false;

  const [localBookings, busyBlocks] = await Promise.all([
    listConfirmedBookingsInRange(client, slotStart.toISO()!, slotEnd.toISO()!),
    queryFreeBusy(tenantId, slotStart.toISO()!, slotEnd.toISO()!),
  ]);
  if (localBookings.some((b) => overlaps(slotStart, slotEnd, b.startsAt, b.endsAt))) return false;
  if (busyBlocks.some((b) => overlaps(slotStart, slotEnd, b.start, b.end))) return false;

  return true;
}
