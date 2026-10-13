import { Pool } from "pg";
import { config } from "../lib/config.js";

// Deliberately the restricted `captus_app` role (config.appDatabaseUrl), not
// the superuser `captus` role (config.databaseUrl) — superusers bypass Row
// Level Security entirely, which would make Stage 3's tenant isolation a no-op.
//
// Keep idle connections around for a while: a fresh connection to a remote
// managed Postgres costs several network round-trips (TCP + TLS + SCRAM), and
// pg's 10s default meant almost every dashboard page load paid that again.
export const pool = new Pool({
  connectionString: config.appDatabaseUrl,
  idleTimeoutMillis: 5 * 60_000,
  keepAlive: true,
});
