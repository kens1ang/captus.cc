import type { PoolClient } from "pg";
import type { SectionKey } from "../lib/businessInfo.js";

export interface BusinessInfoRow {
  section: SectionKey;
  data: unknown;
  updatedAt: string;
}

/** Every section this tenant has saved (RLS scopes it). Unsaved sections are simply absent. */
export async function listBusinessInfo(client: PoolClient): Promise<BusinessInfoRow[]> {
  const result = await client.query<{ section: SectionKey; data: unknown; updated_at: string }>(
    `SELECT section, data, updated_at FROM business_info`,
  );
  return result.rows.map((r) => ({ section: r.section, data: r.data, updatedAt: r.updated_at }));
}

export async function upsertBusinessInfo(client: PoolClient, tenantId: string, section: SectionKey, data: unknown): Promise<void> {
  await client.query(
    `INSERT INTO business_info (tenant_id, section, data, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (tenant_id, section) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [tenantId, section, JSON.stringify(data)],
  );
}
