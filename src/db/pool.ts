import { Pool } from "pg";
import { config } from "../lib/config.js";

// Deliberately the restricted `captus_app` role (config.appDatabaseUrl), not
// the superuser `captus` role (config.databaseUrl) — superusers bypass Row
// Level Security entirely, which would make Stage 3's tenant isolation a no-op.
//
// Keep idle connections around for a while: a fresh connection to a remote
// managed Postgres costs several network round-trips (TCP + TLS + SCRAM), and
// pg's 10s default meant almost every dashboard page load paid that again.
//
// 4 minutes, not 5: Neon's free tier suspends after 5 idle minutes and
// kills open connections when it does, so release ours first.
export const pool = new Pool({
  connectionString: config.appDatabaseUrl,
  idleTimeoutMillis: 4 * 60_000,
  keepAlive: true,
});

// An idle pooled connection that dies (Neon suspending, a DB restart, a
// network blip) makes the pool emit 'error' — and an unhandled 'error' event
// kills the whole Node process, taking the webhook server and every worker
// with it. Found by the e2e harness stopping Postgres mid-run. The pool has
// already discarded the dead client; the next query just opens a new one.
pool.on("error", (err) => {
  console.warn("[db] idle connection dropped (will reconnect on next query):", err.message);
});
