import type { PoolClient } from "pg";

export type BookingStatus = "confirmed" | "cancelled";

export interface Booking {
  id: string;
  conversationId: string | null;
  serviceId: string | null;
  serviceName: string | null;
  contactWaNumber: string;
  contactName: string | null;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  googleEventId: string | null;
}

interface BookingRow {
  id: string;
  conversation_id: string | null;
  service_id: string | null;
  service_name: string | null;
  contact_wa_number: string;
  contact_name: string | null;
  // node-postgres parses timestamptz into a JS Date, not a string.
  starts_at: Date;
  ends_at: Date;
  status: BookingStatus;
  google_event_id: string | null;
}

const SELECT_WITH_SERVICE_NAME = `
  SELECT b.id, b.conversation_id, b.service_id, s.name AS service_name, b.contact_wa_number,
         b.contact_name, b.starts_at, b.ends_at, b.status, b.google_event_id
  FROM bookings b
  LEFT JOIN services s ON s.id = b.service_id
`;

function toBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    serviceId: row.service_id,
    serviceName: row.service_name,
    contactWaNumber: row.contact_wa_number,
    contactName: row.contact_name,
    // Normalized to ISO strings here, once: everything downstream parses
    // these with luxon's DateTime.fromISO, which turns a Date object into
    // "Invalid DateTime" without throwing. Passing the raw Date through
    // made every overlap check quietly false, so existing bookings never
    // blocked a slot (double-booking, capacity ignored) — found by the e2e
    // harness. The type said string all along; it never was.
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    status: row.status,
    googleEventId: row.google_event_id,
  };
}

export async function createBooking(
  client: PoolClient,
  tenantId: string,
  input: {
    conversationId: string | null;
    serviceId: string;
    contactWaNumber: string;
    contactName: string | null;
    startsAt: string; // ISO
    endsAt: string; // ISO
    googleEventId: string | null;
  },
): Promise<Booking> {
  const result = await client.query<BookingRow>(
    `INSERT INTO bookings (tenant_id, conversation_id, service_id, contact_wa_number, contact_name, starts_at, ends_at, google_event_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, conversation_id, service_id, NULL AS service_name, contact_wa_number, contact_name, starts_at, ends_at, status, google_event_id`,
    [
      tenantId,
      input.conversationId,
      input.serviceId,
      input.contactWaNumber,
      input.contactName,
      input.startsAt,
      input.endsAt,
      input.googleEventId,
    ],
  );
  return toBooking(result.rows[0]);
}

/**
 * Confirmed bookings overlapping [rangeStart, rangeEnd) — used by
 * lib/availability.ts as a fast local double-booking guard alongside the
 * live Google freebusy check (covers the gap between "we booked it" and
 * "Google's API has fully caught up", and works even if the calendar write
 * itself is still in flight).
 */
export async function listConfirmedBookingsInRange(client: PoolClient, rangeStart: string, rangeEnd: string): Promise<Booking[]> {
  const result = await client.query<BookingRow>(
    `${SELECT_WITH_SERVICE_NAME}
     WHERE b.status = 'confirmed' AND b.starts_at < $2 AND b.ends_at > $1
     ORDER BY b.starts_at`,
    [rangeStart, rangeEnd],
  );
  return result.rows.map(toBooking);
}

/**
 * Dashboard's bookings list — soonest upcoming first. Confirmed only: a
 * cancelled booking with a future starts_at previously stayed in this list
 * forever (nothing filtered on status), so it never actually disappeared
 * after cancelling, and clicking Cancel on it again hit the
 * already-cancelled 404 path — this filter is the actual fix for that.
 */
export async function listUpcomingBookings(client: PoolClient, limit = 100): Promise<Booking[]> {
  const result = await client.query<BookingRow>(
    `${SELECT_WITH_SERVICE_NAME}
     WHERE b.status = 'confirmed' AND b.starts_at > now()
     ORDER BY b.starts_at
     LIMIT $1`,
    [limit],
  );
  return result.rows.map(toBooking);
}

/** Same as listUpcomingBookings but scoped to one customer — the bot's list_my_bookings tool, so it can find/confirm which booking a "cancel my appointment" or "reschedule" request refers to. */
export async function listUpcomingBookingsForContact(client: PoolClient, contactWaNumber: string, limit = 20): Promise<Booking[]> {
  const result = await client.query<BookingRow>(
    `${SELECT_WITH_SERVICE_NAME}
     WHERE b.status = 'confirmed' AND b.starts_at > now() AND b.contact_wa_number = $1
     ORDER BY b.starts_at
     LIMIT $2`,
    [contactWaNumber, limit],
  );
  return result.rows.map(toBooking);
}

export async function getBookingById(client: PoolClient, id: string): Promise<Booking | null> {
  const result = await client.query<BookingRow>(`${SELECT_WITH_SERVICE_NAME} WHERE b.id = $1`, [id]);
  return result.rows[0] ? toBooking(result.rows[0]) : null;
}

/** Upcoming bookings whose reminder hasn't gone out — what lib/bookingReminders.ts re-queues on startup. */
export async function listBookingsAwaitingReminder(client: PoolClient): Promise<Booking[]> {
  const result = await client.query<BookingRow>(
    `${SELECT_WITH_SERVICE_NAME}
     WHERE b.status = 'confirmed' AND b.reminder_sent_at IS NULL AND b.starts_at > now()
     ORDER BY b.starts_at`,
  );
  return result.rows.map(toBooking);
}

/** Idempotency guard for the reminder worker: returns false if a reminder was already recorded (so a BullMQ retry after a successful send doesn't double-send). */
export async function markReminderSent(client: PoolClient, id: string): Promise<boolean> {
  const result = await client.query(`UPDATE bookings SET reminder_sent_at = now() WHERE id = $1 AND reminder_sent_at IS NULL`, [id]);
  return (result.rowCount ?? 0) > 0;
}

/** Returns the booking as it was before cancelling (so the caller can still delete its Google Calendar event), or null if not found/already cancelled. */
export async function cancelBooking(client: PoolClient, id: string): Promise<Booking | null> {
  const existing = await getBookingById(client, id);
  if (!existing || existing.status === "cancelled") return null;
  await client.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [id]);
  return existing;
}
