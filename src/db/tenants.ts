import { pool } from "./pool.js";

// The `tenants` table itself isn't tenant-scoped (there's no tenant_id on
// it — it IS the tenant list), so these use the raw pool, not withTenant.

export interface Tenant {
  id: string;
  businessName: string;
  businessDescription: string;
  whatsappPhoneNumberId: string;
}

interface TenantRow {
  id: string;
  business_name: string;
  business_description: string;
  whatsapp_phone_number_id: string;
}

function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    businessName: row.business_name,
    businessDescription: row.business_description,
    whatsappPhoneNumberId: row.whatsapp_phone_number_id,
  };
}

const SELECT_COLUMNS = "id, business_name, business_description, whatsapp_phone_number_id";

export async function getTenantById(id: string): Promise<Tenant | null> {
  const result = await pool.query<TenantRow>(`SELECT ${SELECT_COLUMNS} FROM tenants WHERE id = $1`, [id]);
  return result.rows[0] ? toTenant(result.rows[0]) : null;
}

/** Routes an inbound webhook to its tenant — every inbound message is matched by the WhatsApp number it arrived on. */
export async function getTenantByPhoneNumberId(phoneNumberId: string): Promise<Tenant | null> {
  const result = await pool.query<TenantRow>(
    `SELECT ${SELECT_COLUMNS} FROM tenants WHERE whatsapp_phone_number_id = $1`,
    [phoneNumberId],
  );
  return result.rows[0] ? toTenant(result.rows[0]) : null;
}

export async function createTenant(input: {
  businessName: string;
  businessDescription: string;
  whatsappPhoneNumberId: string;
}): Promise<Tenant> {
  const result = await pool.query<TenantRow>(
    `INSERT INTO tenants (business_name, business_description, whatsapp_phone_number_id)
     VALUES ($1, $2, $3) RETURNING ${SELECT_COLUMNS}`,
    [input.businessName, input.businessDescription, input.whatsappPhoneNumberId],
  );
  return toTenant(result.rows[0]);
}

export async function listTenants(): Promise<Tenant[]> {
  const result = await pool.query<TenantRow>(`SELECT ${SELECT_COLUMNS} FROM tenants ORDER BY created_at`);
  return result.rows.map(toTenant);
}
