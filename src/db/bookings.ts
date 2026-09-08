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
  starts_at: string;
  ends_at: string;
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
    startsAt: row.starts_at,
    endsAt: row.ends_at,
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

/** Dashboard's bookings list — soonest upcoming first. */
export async function listUpcomingBookings(client: PoolClient, limit = 100): Promise<Booking[]> {
  const result = await client.query<BookingRow>(
    `${SELECT_WITH_SERVICE_NAME}
     WHERE b.starts_at > now()
     ORDER BY b.starts_at
     LIMIT $1`,
    [limit],
  );
  return result.rows.map(toBooking);
}

export async function getBookingById(client: PoolClient, id: string): Promise<Booking | null> {
  const result = await client.query<BookingRow>(`${SELECT_WITH_SERVICE_NAME} WHERE b.id = $1`, [id]);
  return result.rows[0] ? toBooking(result.rows[0]) : null;
}

/** Returns the booking as it was before cancelling (so the caller can still delete its Google Calendar event), or null if not found/already cancelled. */
export async function cancelBooking(client: PoolClient, id: string): Promise<Booking | null> {
  const existing = await getBookingById(client, id);
  if (!existing || existing.status === "cancelled") return null;
  await client.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [id]);
  return existing;
}
