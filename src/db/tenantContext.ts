import type { PoolClient } from "pg";
import { pool } from "./pool.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` inside a transaction with Postgres RLS's `app.tenant_id` set for
 * its duration (SET LOCAL via set_config — scoped to this transaction only,
 * safe with a pooled connection reused elsewhere). Every query against a
 * tenant-scoped table (conversations, messages, knowledge_chunks) must go
 * through this: the tables have FORCE ROW LEVEL SECURITY, so a query that
 * skips this and never sets app.tenant_id sees/writes nothing — a fail-closed
 * default, not a fail-open one. This is the actual isolation guarantee from
 * the architecture doc's §3 ("even a bug in your app code can't leak one
 * tenant's data into another's queries") — not just the tenant_id column.
 */
export async function withTenant<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(tenantId)) throw new Error(`withTenant: invalid tenant id ${JSON.stringify(tenantId)}`);
  const client = await pool.connect();
  try {
    // BEGIN and the tenant setting go in one round-trip. Multi-statement text
    // can't take bind parameters, so the id is inlined — safe because it was
    // checked above to be a bare UUID.
    await client.query(`BEGIN; SELECT set_config('app.tenant_id', '${tenantId}', true)`);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
