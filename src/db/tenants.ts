import { pool } from "./pool.js";

// The `tenants` table itself isn't tenant-scoped (there's no tenant_id on
// it — it IS the tenant list), so these use the raw pool, not withTenant.

export interface Tenant {
  id: string;
  businessName: string;
  businessDescription: string;
  /** null until a WhatsApp number is connected (self-serve signups start without one). */
  whatsappPhoneNumberId: string | null;
  whatsappBusinessAccountId: string | null;
  timezone: string;
  bookingMinNoticeMinutes: number;
}

interface TenantRow {
  id: string;
  business_name: string;
  business_description: string;
  whatsapp_phone_number_id: string | null;
  whatsapp_business_account_id: string | null;
  timezone: string;
  booking_min_notice_minutes: number;
}

function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    businessName: row.business_name,
    businessDescription: row.business_description,
    whatsappPhoneNumberId: row.whatsapp_phone_number_id,
    whatsappBusinessAccountId: row.whatsapp_business_account_id,
    timezone: row.timezone,
    bookingMinNoticeMinutes: row.booking_min_notice_minutes,
  };
}

const SELECT_COLUMNS =
  "id, business_name, business_description, whatsapp_phone_number_id, whatsapp_business_account_id, timezone, booking_min_notice_minutes";

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
  whatsappPhoneNumberId?: string;
  whatsappBusinessAccountId?: string;
  timezone?: string;
}): Promise<Tenant> {
  const result = await pool.query<TenantRow>(
    `INSERT INTO tenants (business_name, business_description, whatsapp_phone_number_id, whatsapp_business_account_id, timezone)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'Asia/Singapore')) RETURNING ${SELECT_COLUMNS}`,
    [input.businessName, input.businessDescription, input.whatsappPhoneNumberId ?? null, input.whatsappBusinessAccountId ?? null, input.timezone ?? null],
  );
  return toTenant(result.rows[0]);
}

export async function updateTenantTimezone(id: string, timezone: string): Promise<Tenant | null> {
  const result = await pool.query<TenantRow>(`UPDATE tenants SET timezone = $2 WHERE id = $1 RETURNING ${SELECT_COLUMNS}`, [
    id,
    timezone,
  ]);
  return result.rows[0] ? toTenant(result.rows[0]) : null;
}

export async function updateTenantBookingNotice(id: string, minutes: number): Promise<Tenant | null> {
  const result = await pool.query<TenantRow>(
    `UPDATE tenants SET booking_min_notice_minutes = $2 WHERE id = $1 RETURNING ${SELECT_COLUMNS}`,
    [id, minutes],
  );
  return result.rows[0] ? toTenant(result.rows[0]) : null;
}

export async function updateTenantWhatsappBusinessAccountId(id: string, whatsappBusinessAccountId: string): Promise<Tenant | null> {
  const result = await pool.query<TenantRow>(
    `UPDATE tenants SET whatsapp_business_account_id = $2 WHERE id = $1 RETURNING ${SELECT_COLUMNS}`,
    [id, whatsappBusinessAccountId],
  );
  return result.rows[0] ? toTenant(result.rows[0]) : null;
}

/** Connects a WhatsApp number to a tenant that signed up without one. */
export async function updateTenantWhatsappPhoneNumberId(id: string, whatsappPhoneNumberId: string): Promise<Tenant | null> {
  const result = await pool.query<TenantRow>(
    `UPDATE tenants SET whatsapp_phone_number_id = $2 WHERE id = $1 RETURNING ${SELECT_COLUMNS}`,
    [id, whatsappPhoneNumberId],
  );
  return result.rows[0] ? toTenant(result.rows[0]) : null;
}

export async function listTenants(): Promise<Tenant[]> {
  const result = await pool.query<TenantRow>(`SELECT ${SELECT_COLUMNS} FROM tenants ORDER BY created_at`);
  return result.rows.map(toTenant);
}

export async function updateTenantProfile(id: string, businessName: string, businessDescription: string): Promise<Tenant | null> {
  const result = await pool.query<TenantRow>(
    `UPDATE tenants SET business_name = $2, business_description = $3 WHERE id = $1 RETURNING ${SELECT_COLUMNS}`,
    [id, businessName, businessDescription],
  );
  return result.rows[0] ? toTenant(result.rows[0]) : null;
}
