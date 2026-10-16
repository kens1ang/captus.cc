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
 * Most bookings running at the same moment anywhere inside [slotStart,
 * slotEnd). Not just "how many overlap the slot": with a 60-minute slot,
 * a 10:00-10:30 and a 10:30-11:00 booking both overlap it but never run
 * together, so they only use one unit of capacity. Concurrency can only
 * rise at a booking's start, so checking the slot start plus every booking
 * start inside the slot finds the peak.
 */
function peakConcurrent(slotStart: DateTime, slotEnd: DateTime, bookings: { startsAt: string; endsAt: string }[]): number {
  const relevant = bookings
    .map((b) => ({ start: DateTime.fromISO(b.startsAt), end: DateTime.fromISO(b.endsAt) }))
    .filter((b) => b.start < slotEnd && b.end > slotStart);
  const points = [slotStart, ...relevant.map((b) => b.start).filter((s) => s > slotStart)];
  let peak = 0;
  for (const p of points) {
    const n = relevant.filter((b) => b.start <= p && b.end > p).length;
    if (n > peak) peak = n;
  }
  return peak;
}

/**
 * Real, deterministic availability — never something the LLM invents. Walks
 * the tenant's weekly business hours on a 30-minute grid over the next two
 * weeks, filtering out anything that overlaps either a locally-confirmed
 * booking (once the service's capacity is used up) or a busy block on the
 * tenant's actual Google Calendar (meetings,
 * holidays, anything not made through Captus). If the tenant hasn't
 * connected a calendar, queryFreeBusy just returns [] and this still works
 * off local bookings alone.
 *
 * `preferredDate` (YYYY-MM-DD, tenant-local) starts the search from that day
 * instead of today — without it, a customer asking for "tomorrow" could get
 * silently handed today's slots instead just because today still had 8+ open
 * (MAX_SLOTS_RETURNED cutting the search short before ever reaching
 * tomorrow) — confirmed live: exactly this happened before this was added.
 * If the preferred day itself has nothing open, the search still continues
 * into later days as a fallback, same as with no preference at all.
 *
 * `preferredTime` (HH:mm, tenant-local) does the same for the time of day:
 * the slots returned for the preferred day are the ones CLOSEST to it, not
 * the first few from opening. Without it, "tomorrow at 3pm" at a place
 * opening 8am only ever saw 8:00–11:30 (the first 8), so the assistant told
 * the customer 3pm was taken when it was wide open — found by the e2e
 * harness.
 */
export async function computeAvailableSlots(
  client: PoolClient,
  tenantId: string,
  timezone: string,
  durationMinutes: number,
  capacity: number,
  preferredDate?: string,
  preferredTime?: string,
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

  const preferred = preferredDate ? DateTime.fromISO(preferredDate, { zone: timezone }) : null;
  const startDayOffset = preferred?.isValid ? Math.max(0, Math.floor(preferred.startOf("day").diff(now.startOf("day"), "days").days)) : 0;
  const timeMatch = preferredTime?.match(/^(\d{1,2}):(\d{2})$/);

  /** Every open slot on one day, in order. */
  function openSlotsOn(dayOffset: number): DateTime[] {
    const day = now.plus({ days: dayOffset }).startOf("day");
    const dayOfWeek = day.weekday % 7; // luxon: 1=Mon..7=Sun -> 0=Sun..6=Sat, matching schema
    const open: DateTime[] = [];
    for (const interval of hours.filter((h) => h.dayOfWeek === dayOfWeek)) {
      const [startH, startM] = interval.startTime.split(":").map(Number);
      const [endH, endM] = interval.endTime.split(":").map(Number);
      const intervalStart = day.set({ hour: startH, minute: startM });
      const intervalEnd = day.set({ hour: endH, minute: endM });

      for (let slotStart = intervalStart; slotStart.plus({ minutes: durationMinutes }) <= intervalEnd; slotStart = slotStart.plus({ minutes: SLOT_GRID_MINUTES })) {
        if (slotStart < earliestStart) continue;
        const slotEnd = slotStart.plus({ minutes: durationMinutes });
        const clashesLocally = peakConcurrent(slotStart, slotEnd, localBookings) >= capacity;
        const clashesOnCalendar = busyBlocks.some((b) => overlaps(slotStart, slotEnd, b.start, b.end));
        if (!clashesLocally && !clashesOnCalendar) open.push(slotStart);
      }
    }
    return open;
  }

  for (let dayOffset = startDayOffset; dayOffset < SEARCH_DAYS_AHEAD && slots.length < MAX_SLOTS_RETURNED; dayOffset++) {
    let open = openSlotsOn(dayOffset);
    if (timeMatch && dayOffset === startDayOffset && open.length) {
      // The ones nearest the requested time, then back in time order.
      const target = open[0].set({ hour: Number(timeMatch[1]), minute: Number(timeMatch[2]) });
      open = [...open]
        .sort((a, b) => Math.abs(a.diff(target).toMillis()) - Math.abs(b.diff(target).toMillis()))
        .slice(0, MAX_SLOTS_RETURNED)
        .sort((a, b) => a.toMillis() - b.toMillis());
    }
    for (const slotStart of open) {
      if (slots.length >= MAX_SLOTS_RETURNED) break;
      slots.push({ startISO: slotStart.toISO()!, endISO: slotStart.plus({ minutes: durationMinutes }).toISO()! });
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
  capacity: number,
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
  if (peakConcurrent(slotStart, slotEnd, localBookings) >= capacity) return false;
  if (busyBlocks.some((b) => overlaps(slotStart, slotEnd, b.start, b.end))) return false;

  return true;
}
