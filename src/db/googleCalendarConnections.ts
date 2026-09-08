import type { PoolClient } from "pg";
import { encrypt, decrypt } from "../lib/crypto.js";

export interface GoogleCalendarConnection {
  calendarId: string;
  refreshToken: string; // decrypted
  connectedEmail: string | null;
}

interface ConnectionRow {
  calendar_id: string;
  refresh_token_encrypted: string;
  connected_email: string | null;
}

export async function getGoogleCalendarConnection(client: PoolClient): Promise<GoogleCalendarConnection | null> {
  const result = await client.query<ConnectionRow>(
    `SELECT calendar_id, refresh_token_encrypted, connected_email FROM google_calendar_connections LIMIT 1`,
  );
  const row = result.rows[0];
  if (!row) return null;
  return { calendarId: row.calendar_id, refreshToken: decrypt(row.refresh_token_encrypted), connectedEmail: row.connected_email };
}

/** Upsert — reconnecting (e.g. after revoking access) replaces the stored token rather than erroring. */
export async function saveGoogleCalendarConnection(
  client: PoolClient,
  tenantId: string,
  refreshToken: string,
  connectedEmail: string | null,
  calendarId = "primary",
): Promise<void> {
  await client.query(
    `INSERT INTO google_calendar_connections (tenant_id, calendar_id, refresh_token_encrypted, connected_email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id) DO UPDATE SET
       calendar_id = EXCLUDED.calendar_id,
       refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
       connected_email = EXCLUDED.connected_email,
       connected_at = now()`,
    [tenantId, calendarId, encrypt(refreshToken), connectedEmail],
  );
}

export async function deleteGoogleCalendarConnection(client: PoolClient): Promise<boolean> {
  const result = await client.query(`DELETE FROM google_calendar_connections`);
  return (result.rowCount ?? 0) > 0;
}
