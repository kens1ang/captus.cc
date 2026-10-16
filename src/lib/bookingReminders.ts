import { DateTime } from "luxon";
import { reminderQueue } from "./queue.js";
import { listTenants } from "../db/tenants.js";
import { withTenant } from "../db/tenantContext.js";
import { listBookingsAwaitingReminder } from "../db/bookings.js";

// Utility-category WhatsApp template, created once via
// src/scripts/create-reminder-template.ts and approved by Meta before any
// reminder can actually send — see that script for the exact body text.
export const REMINDER_TEMPLATE_NAME = "booking_reminder";
export const REMINDER_TEMPLATE_LANGUAGE = "en";

const LEAD_TIME_HOURS = Number(process.env.BOOKING_REMINDER_LEAD_HOURS ?? 24);

function jobId(bookingId: string): string {
  return `reminder_${bookingId}`;
}

/**
 * Schedules a reminder to fire LEAD_TIME_HOURS before `startISO`. A no-op if
 * that moment has already passed (booked too soon before the appointment
 * for a lead-time reminder to make sense) or Redis is briefly unavailable —
 * the reminder queue is a nice-to-have, never the reason a booking itself fails.
 */
export async function scheduleReminder(tenantId: string, bookingId: string, startISO: string): Promise<void> {
  const remindAt = DateTime.fromISO(startISO).minus({ hours: LEAD_TIME_HOURS });
  const delayMs = remindAt.diff(DateTime.now()).as("milliseconds");
  if (delayMs <= 0) return; // appointment is sooner than the lead time — nothing to schedule

  try {
    await reminderQueue.add("remind", { tenantId, bookingId }, { jobId: jobId(bookingId), delay: delayMs });
  } catch (err) {
    console.warn(`[bookingReminders] failed to schedule reminder for booking ${bookingId}:`, err);
  }
}

/**
 * Re-queues every reminder that should exist, from the bookings table (the
 * source of truth). Run on startup because the queue lives in Redis, and
 * Render's free Redis keeps nothing across a restart — one restart used to
 * silently cancel every reminder scheduled days ahead.
 *
 * Idempotent: a reminder still in the queue has the same jobId, so re-adding
 * it is a no-op. A reminder whose send time passed while it was lost goes
 * out now, as long as the appointment is still at least an hour away.
 */
export async function restoreReminders(): Promise<number> {
  let restored = 0;
  for (const tenant of await listTenants()) {
    const bookings = await withTenant(tenant.id, (client) => listBookingsAwaitingReminder(client));
    for (const b of bookings) {
      const start = DateTime.fromISO(b.startsAt);
      const remindAt = start.minus({ hours: LEAD_TIME_HOURS });
      const overdue = remindAt <= DateTime.now();
      if (overdue && start.diff(DateTime.now()).as("hours") < 1) continue; // too late to be useful
      const delay = Math.max(0, remindAt.diff(DateTime.now()).as("milliseconds"));
      const job = await reminderQueue.getJob(jobId(b.id));
      if (job) continue;
      await reminderQueue.add("remind", { tenantId: tenant.id, bookingId: b.id }, { jobId: jobId(b.id), delay });
      restored++;
    }
  }
  return restored;
}

/**
 * Removes a booking's pending reminder — call this on every path that
 * cancels or supersedes a booking (bot-driven cancel_appointment, the
 * cancel leg of reschedule_appointment, and the dashboard's cancel route),
 * or a cancelled/rescheduled booking would still get reminded about.
 */
export async function cancelReminder(bookingId: string): Promise<void> {
  try {
    const job = await reminderQueue.getJob(jobId(bookingId));
    if (!job) return;
    const state = await job.getState();
    if (state !== "active") {
      await job.remove();
    }
  } catch (err) {
    console.warn(`[bookingReminders] failed to cancel reminder for booking ${bookingId}:`, err);
  }
}

/** The reminder message content — shared between the actual WhatsApp template send and the message row logged for the dashboard thread. */
export function reminderBodyParams(serviceName: string, rangeLabel: string): string[] {
  return [serviceName, rangeLabel];
}

export function reminderPlainText(serviceName: string, rangeLabel: string): string {
  return `Reminder: you have a ${serviceName} appointment scheduled for ${rangeLabel}. Reply here if you'd like to reschedule or cancel.`;
}

export const bookingReminderLeadHours = LEAD_TIME_HOURS;
