// Minimal FAQ ingestion: paste text → chunk → embed → pgvector, scoped to one tenant.
// Usage: npm run ingest -- <whatsapp-phone-number-id> path/to/faq.txt
import { readFileSync } from "node:fs";
import { ingestKnowledgeText } from "../lib/knowledgeIngest.js";
import { getTenantByPhoneNumberId } from "../db/tenants.js";
import { pool } from "../db/pool.js";

async function main() {
  const [phoneNumberId, filePath] = process.argv.slice(2);
  if (!phoneNumberId || !filePath) {
    console.error("Usage: npm run ingest -- <whatsapp-phone-number-id> <path-to-faq.txt>");
    process.exit(1);
  }

  const tenant = await getTenantByPhoneNumberId(phoneNumberId);
  if (!tenant) {
    console.error(`No tenant found for WhatsApp phone number id "${phoneNumberId}". Run "npm run onboard" first.`);
    process.exit(1);
  }

  const text = readFileSync(filePath, "utf-8");
  console.log(`Ingesting "${filePath}" for tenant "${tenant.businessName}"...`);
  const count = await ingestKnowledgeText(tenant.id, text, filePath);
  console.log(`Done — ingested ${count} chunk(s).`);

  await pool.end();
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
