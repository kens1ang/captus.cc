// Stage 4: grant a Clerk-authenticated user access to a tenant's dashboard.
// Get the Clerk user id from the Clerk dashboard (Users > click a user > "User ID").
// Usage: npm run link-user -- <clerk-user-id> <email> <whatsapp-phone-number-id> [role]
import { linkUserToTenant } from "../db/users.js";
import { getTenantByPhoneNumberId } from "../db/tenants.js";
import { pool } from "../db/pool.js";

async function main() {
  const [clerkUserId, email, phoneNumberId, role] = process.argv.slice(2);
  if (!clerkUserId || !email || !phoneNumberId) {
    console.error("Usage: npm run link-user -- <clerk-user-id> <email> <whatsapp-phone-number-id> [role]");
    process.exit(1);
  }

  const tenant = await getTenantByPhoneNumberId(phoneNumberId);
  if (!tenant) {
    console.error(`No tenant found for WhatsApp phone number id "${phoneNumberId}". Run "npm run onboard" first.`);
    process.exit(1);
  }

  const user = await linkUserToTenant({ clerkUserId, email, tenantId: tenant.id, role });
  console.log(`Linked ${email} (Clerk user ${clerkUserId}) to tenant "${tenant.businessName}" as "${user.role}".`);

  await pool.end();
}

main().catch((err) => {
  console.error("Linking failed:", err);
  process.exit(1);
});
