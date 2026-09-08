import type { PoolClient } from "pg";

export interface Service {
  id: string;
  name: string;
  durationMinutes: number;
}

interface ServiceRow {
  id: string;
  name: string;
  duration_minutes: number;
}

function toService(row: ServiceRow): Service {
  return { id: row.id, name: row.name, durationMinutes: row.duration_minutes };
}

/** Dashboard's services config + what the booking tool matches a customer's request against. */
export async function listServices(client: PoolClient): Promise<Service[]> {
  const result = await client.query<ServiceRow>(`SELECT id, name, duration_minutes FROM services ORDER BY name`);
  return result.rows.map(toService);
}

export async function getServiceById(client: PoolClient, id: string): Promise<Service | null> {
  const result = await client.query<ServiceRow>(`SELECT id, name, duration_minutes FROM services WHERE id = $1`, [id]);
  return result.rows[0] ? toService(result.rows[0]) : null;
}

export async function createService(
  client: PoolClient,
  tenantId: string,
  name: string,
  durationMinutes: number,
): Promise<Service> {
  const result = await client.query<ServiceRow>(
    `INSERT INTO services (tenant_id, name, duration_minutes) VALUES ($1, $2, $3) RETURNING id, name, duration_minutes`,
    [tenantId, name, durationMinutes],
  );
  return toService(result.rows[0]);
}

/** Returns whether a row was actually deleted (false if it belonged to another tenant, blocked by RLS). */
export async function deleteService(client: PoolClient, id: string): Promise<boolean> {
  const result = await client.query(`DELETE FROM services WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
