import type { PoolClient } from "pg";

export interface Service {
  id: string;
  name: string;
  durationMinutes: number;
  /** Max bookings allowed to overlap at once (any service) while this one is still offered. */
  capacity: number;
}

interface ServiceRow {
  id: string;
  name: string;
  duration_minutes: number;
  capacity: number;
}

const COLUMNS = `id, name, duration_minutes, capacity`;

function toService(row: ServiceRow): Service {
  return { id: row.id, name: row.name, durationMinutes: row.duration_minutes, capacity: row.capacity };
}

/** Dashboard's services config + what the booking tool matches a customer's request against. */
export async function listServices(client: PoolClient): Promise<Service[]> {
  const result = await client.query<ServiceRow>(`SELECT ${COLUMNS} FROM services ORDER BY name`);
  return result.rows.map(toService);
}

export async function getServiceById(client: PoolClient, id: string): Promise<Service | null> {
  const result = await client.query<ServiceRow>(`SELECT ${COLUMNS} FROM services WHERE id = $1`, [id]);
  return result.rows[0] ? toService(result.rows[0]) : null;
}

export async function createService(
  client: PoolClient,
  tenantId: string,
  name: string,
  durationMinutes: number,
  capacity: number,
): Promise<Service> {
  const result = await client.query<ServiceRow>(
    `INSERT INTO services (tenant_id, name, duration_minutes, capacity) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
    [tenantId, name, durationMinutes, capacity],
  );
  return toService(result.rows[0]);
}

/** Returns null if no row was updated (missing, or another tenant's — blocked by RLS). */
export async function updateService(
  client: PoolClient,
  id: string,
  input: { durationMinutes: number; capacity: number },
): Promise<Service | null> {
  const result = await client.query<ServiceRow>(
    `UPDATE services SET duration_minutes = $2, capacity = $3 WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, input.durationMinutes, input.capacity],
  );
  return result.rows[0] ? toService(result.rows[0]) : null;
}

/** Returns whether a row was actually deleted (false if it belonged to another tenant, blocked by RLS). */
export async function deleteService(client: PoolClient, id: string): Promise<boolean> {
  const result = await client.query(`DELETE FROM services WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
