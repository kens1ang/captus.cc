import { Pool } from "pg";
import { config } from "../lib/config.js";

// Deliberately the restricted `captus_app` role (config.appDatabaseUrl), not
// the superuser `captus` role (config.databaseUrl) — superusers bypass Row
// Level Security entirely, which would make Stage 3's tenant isolation a no-op.
export const pool = new Pool({ connectionString: config.appDatabaseUrl });
