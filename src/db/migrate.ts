import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { config } from "../lib/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CREATE/ALTER ROLE's PASSWORD clause doesn't accept a bind parameter ($1) —
// it needs a literal. Safe here since the password is a trusted, locally
// configured value (APP_DB_PASSWORD), not user input.
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// Same deal for the database name interpolated into GRANT CONNECT ON DATABASE
// below — that's an identifier position, not a literal, so it needs double
// quotes rather than single. Sourced from current_database(), not user input.
function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

// Run once schema.sql has created tenant_id columns and every pre-Stage-3 row
// has been backfilled onto a real tenant — enabling this any earlier would
// have FORCE RLS blocking the backfill itself (app.tenant_id isn't set yet).
const ENABLE_RLS_SQL = [
  "conversations",
  "messages",
  "knowledge_chunks",
  "services",
  "business_hours",
  "bookings",
  "google_calendar_connections",
]
  .map(
    (table) => `
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ${table};
CREATE POLICY tenant_isolation ON ${table}
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
`,
  )
  .join("\n");

async function main() {
  const pool = new Pool({ connectionString: config.databaseUrl });

  const schemaSql = readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  await pool.query(schemaSql);
  console.log("Base schema applied.");

  // The restricted role the running app actually connects as (db/pool.ts) —
  // must NOT be a superuser and must not have BYPASSRLS, or RLS enforces
  // nothing for it. Idempotent: safe to rerun (password kept in sync with
  // APP_DB_PASSWORD in case it changed).
  const roleExists = await pool.query(`SELECT 1 FROM pg_roles WHERE rolname = 'captus_app'`);
  if (roleExists.rowCount === 0) {
    await pool.query(`CREATE ROLE captus_app LOGIN PASSWORD ${quoteLiteral(config.appDbPassword)}`);
    console.log("Created restricted app role captus_app (not a superuser — RLS actually applies to it).");
  } else {
    await pool.query(`ALTER ROLE captus_app WITH PASSWORD ${quoteLiteral(config.appDbPassword)}`);
  }
  // current_database() rather than a hardcoded name — the DB is called
  // "captus" locally (docker-compose.yml) but e.g. "railway" on Railway.
  const { rows: dbRows } = await pool.query<{ current_database: string }>(`SELECT current_database()`);
  const dbName = dbRows[0].current_database;
  await pool.query(`GRANT CONNECT ON DATABASE ${quoteIdent(dbName)} TO captus_app`);
  await pool.query(`GRANT USAGE ON SCHEMA public TO captus_app`);
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, users, conversations, messages, knowledge_chunks,
     services, business_hours, bookings, google_calendar_connections TO captus_app`,
  );
  console.log("Granted captus_app the privileges it needs on tenant-scoped tables.");

  // Stage 3 bootstrap: ensure a default tenant exists (from env) and backfill
  // any pre-Stage-3 rows (tenant_id IS NULL) onto it, before RLS is enforced.
  const defaultPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (defaultPhoneNumberId) {
    const businessName = process.env.BUSINESS_NAME?.trim() || "Our Business";
    const businessDescription = process.env.BUSINESS_DESCRIPTION?.trim() || "";

    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM tenants WHERE whatsapp_phone_number_id = $1`,
      [defaultPhoneNumberId],
    );
    let tenantId: string;
    if (existing.rows[0]) {
      tenantId = existing.rows[0].id;
      console.log(`Default tenant already exists (${tenantId}).`);
    } else {
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO tenants (business_name, business_description, whatsapp_phone_number_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [businessName, businessDescription, defaultPhoneNumberId],
      );
      tenantId = inserted.rows[0].id;
      console.log(`Created default tenant "${businessName}" (${tenantId}).`);
    }

    const backfillConversations = await pool.query(`UPDATE conversations SET tenant_id = $1 WHERE tenant_id IS NULL`, [
      tenantId,
    ]);
    const backfillMessages = await pool.query(`UPDATE messages SET tenant_id = $1 WHERE tenant_id IS NULL`, [
      tenantId,
    ]);
    const backfillKnowledge = await pool.query(`UPDATE knowledge_chunks SET tenant_id = $1 WHERE tenant_id IS NULL`, [
      tenantId,
    ]);
    console.log(
      `Backfilled tenant_id on ${backfillConversations.rowCount} conversation(s), ` +
        `${backfillMessages.rowCount} message(s), ${backfillKnowledge.rowCount} knowledge chunk(s).`,
    );
  } else {
    console.warn("WHATSAPP_PHONE_NUMBER_ID not set — skipping default tenant bootstrap/backfill.");
  }

  await pool.query(ENABLE_RLS_SQL);
  console.log("RLS enabled and enforced on tenant-scoped tables.");

  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
