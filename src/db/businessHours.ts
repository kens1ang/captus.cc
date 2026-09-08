import type { PoolClient } from "pg";

export interface BusinessHoursInterval {
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
  startTime: string; // "HH:MM", 24h
  endTime: string;
}

interface BusinessHoursRow {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

// Postgres returns `time` as "HH:MM:SS" — trim to "HH:MM" for the dashboard/API.
function toInterval(row: BusinessHoursRow): BusinessHoursInterval {
  return { dayOfWeek: row.day_of_week, startTime: row.start_time.slice(0, 5), endTime: row.end_time.slice(0, 5) };
}

export async function listBusinessHours(client: PoolClient): Promise<BusinessHoursInterval[]> {
  const result = await client.query<BusinessHoursRow>(
    `SELECT day_of_week, start_time, end_time FROM business_hours ORDER BY day_of_week, start_time`,
  );
  return result.rows.map(toInterval);
}

/**
 * Replaces the tenant's entire weekly schedule at once (delete + reinsert in
 * one transaction) — simpler for a settings form ("here's the whole week")
 * than incremental per-interval CRUD, and there's no reason to keep stale
 * intervals around once the owner resubmits the form.
 */
export async function replaceBusinessHours(
  client: PoolClient,
  tenantId: string,
  intervals: BusinessHoursInterval[],
): Promise<void> {
  await client.query(`DELETE FROM business_hours`);
  for (const interval of intervals) {
    await client.query(
      `INSERT INTO business_hours (tenant_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)`,
      [tenantId, interval.dayOfWeek, interval.startTime, interval.endTime],
    );
  }
}
