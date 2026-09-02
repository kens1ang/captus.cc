// Stage 3's "bare internal tool" for onboarding a new tenant.
// Usage: npm run onboard -- <whatsapp-phone-number-id> "<business name>" "<business description>"
import { createTenant, getTenantByPhoneNumberId } from "../db/tenants.js";
import { pool } from "../db/pool.js";

async function main() {
  const [phoneNumberId, businessName, businessDescription] = process.argv.slice(2);
  if (!phoneNumberId || !businessName) {
    console.error('Usage: npm run onboard -- <whatsapp-phone-number-id> "<business name>" "<business description>"');
    process.exit(1);
  }

  const existing = await getTenantByPhoneNumberId(phoneNumberId);
  if (existing) {
    console.error(
      `A tenant already exists for phone number id "${phoneNumberId}": "${existing.businessName}" (${existing.id})`,
    );
    process.exit(1);
  }

  const tenant = await createTenant({
    businessName,
    businessDescription: businessDescription ?? "",
    whatsappPhoneNumberId: phoneNumberId,
  });

  console.log(`Created tenant "${tenant.businessName}" (${tenant.id}) for WhatsApp phone number id ${phoneNumberId}.`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Ingest their FAQ:  npm run ingest -- ${phoneNumberId} path/to/their-faq.txt`);
  console.log(
    "  2. In Meta's dashboard for THIS phone number, point its webhook config at the same callback URL/verify " +
      "token as your other tenant(s) — one webhook endpoint serves everyone, routed by phone_number_id.",
  );
  console.log(
    "  3. Subscribe the WABA to the app if you haven't already (POST /{WABA_ID}/subscribed_apps) — see " +
      "captus-whatsapp-setup-gotchas memory for the exact gotchas.",
  );

  await pool.end();
}

main().catch((err) => {
  console.error("Onboarding failed:", err);
  process.exit(1);
});
