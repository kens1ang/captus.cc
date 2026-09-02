import { pool } from "./pool.js";

// Like tenants.ts, this uses the raw pool, never withTenant() — a user's
// tenant_id is how we FIND their tenant in the first place, so this lookup
// can't itself be tenant-scoped.

export interface DashboardUser {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  isAdmin: boolean;
}

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  role: string;
  is_admin: boolean;
}

function toUser(row: UserRow): DashboardUser {
  return { id: row.id, tenantId: row.tenant_id, email: row.email, role: row.role, isAdmin: row.is_admin };
}

export async function getUserByClerkId(clerkUserId: string): Promise<DashboardUser | null> {
  const result = await pool.query<UserRow>(
    `SELECT id, tenant_id, email, role, is_admin FROM users WHERE clerk_user_id = $1`,
    [clerkUserId],
  );
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

export async function linkUserToTenant(input: {
  clerkUserId: string;
  email: string;
  tenantId: string;
  role?: string;
}): Promise<DashboardUser> {
  const result = await pool.query<UserRow>(
    `INSERT INTO users (tenant_id, clerk_user_id, email, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (clerk_user_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, email = EXCLUDED.email, role = EXCLUDED.role
     RETURNING id, tenant_id, email, role, is_admin`,
    [input.tenantId, input.clerkUserId, input.email, input.role ?? "owner"],
  );
  return toUser(result.rows[0]);
}

export async function listUsersForTenant(tenantId: string): Promise<DashboardUser[]> {
  const result = await pool.query<UserRow>(
    `SELECT id, tenant_id, email, role, is_admin FROM users WHERE tenant_id = $1 ORDER BY created_at`,
    [tenantId],
  );
  return result.rows.map(toUser);
}

// One-off bootstrap only — there's no dashboard button for this deliberately.
// The first platform admin has to be promoted directly (chicken-and-egg: the
// admin-only dashboard routes are what would normally do this). Anyone else
// who needs admin, an existing admin promotes by hand the same way.
export async function setAdmin(clerkUserId: string, isAdmin: boolean): Promise<DashboardUser | null> {
  const result = await pool.query<UserRow>(
    `UPDATE users SET is_admin = $2 WHERE clerk_user_id = $1 RETURNING id, tenant_id, email, role, is_admin`,
    [clerkUserId, isAdmin],
  );
  return result.rows[0] ? toUser(result.rows[0]) : null;
}
