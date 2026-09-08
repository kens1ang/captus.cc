// Stage 3's "bare internal tool" for onboarding a new tenant.
// Usage: npm run onboard -- <whatsapp-phone-number-id> "<business name>" "<business description>" [waba-id]
// The WABA id (WhatsApp Manager > API Setup, next to the phone number id) is
// optional at onboarding time — needed later only if this tenant uses
// booking reminders (its own message templates), and can be added/edited
// from the admin dashboard afterwards either way.
import { createTenant, getTenantByPhoneNumberId } from "../db/tenants.js";
import { pool } from "../db/pool.js";

async function main() {
  const [phoneNumberId, businessName, businessDescription, wabaId] = process.argv.slice(2);
  if (!phoneNumberId || !businessName) {
    console.error(
      'Usage: npm run onboard -- <whatsapp-phone-number-id> "<business name>" "<business description>" [waba-id]',
    );
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
    whatsappBusinessAccountId: wabaId,
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
