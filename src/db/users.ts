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

// Every dashboard API call resolves its Clerk user here, and a page load fires
// several in parallel — a short in-memory cache saves a DB round-trip on each.
// Writes below clear it, so linking/role changes made through this process
// show up immediately (a CLI script elsewhere waits out the TTL at worst).
const USER_CACHE_TTL_MS = 60_000;
const userCache = new Map<string, { user: DashboardUser; expiresAt: number }>();

export async function getUserByClerkId(clerkUserId: string): Promise<DashboardUser | null> {
  const cached = userCache.get(clerkUserId);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  const result = await pool.query<UserRow>(
    `SELECT id, tenant_id, email, role, is_admin FROM users WHERE clerk_user_id = $1`,
    [clerkUserId],
  );
  if (!result.rows[0]) return null;
  const user = toUser(result.rows[0]);
  userCache.set(clerkUserId, { user, expiresAt: Date.now() + USER_CACHE_TTL_MS });
  return user;
}

export async function linkUserToTenant(input: {
  clerkUserId: string;
  email: string;
  tenantId: string;
  role?: string;
}): Promise<DashboardUser> {
  userCache.delete(input.clerkUserId);
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
  userCache.delete(clerkUserId);
  const result = await pool.query<UserRow>(
    `UPDATE users SET is_admin = $2 WHERE clerk_user_id = $1 RETURNING id, tenant_id, email, role, is_admin`,
    [clerkUserId, isAdmin],
  );
  return result.rows[0] ? toUser(result.rows[0]) : null;
}
