import fs from "node:fs";
import path from "node:path";
import { db, ROOT, TENANT_A_PHONE_ID, TENANT_B_PHONE_ID } from "./harness.js";

// Two businesses, seeded through the app's own code paths (the same
// normalize → index → store the dashboard's Knowledge pages run), so the
// assistant sees exactly what a real owner's setup would produce.
//   A: Kopi Corner — cafe with bookable tables (capacity) and a menu PDF
//   B: Glow Salon  — different hours/prices; must never see A's data

export interface Seeded {
  tenantA: string;
  tenantB: string;
  tableServiceId: string;
  roomServiceId: string;
}

export async function seed(): Promise<Seeded> {
  // Imported lazily so they pick up the e2e env harness.ts already set.
  const { withTenant } = await import("../src/db/tenantContext.js");
  const { createTenant } = await import("../src/db/tenants.js");
  const { createService } = await import("../src/db/services.js");
  const { replaceBusinessHours } = await import("../src/db/businessHours.js");
  const { upsertBusinessInfo } = await import("../src/db/businessInfo.js");
  const { createDocument } = await import("../src/db/documents.js");
  const { normalizeSection, renderIndexedChunks, knowledgeSourceFor, INDEXED_SECTIONS } = await import("../src/lib/businessInfo.js");
  const { replaceKnowledgeSource } = await import("../src/lib/knowledgeIngest.js");
  type SectionKey = import("../src/lib/businessInfo.js").SectionKey;

  const tenantA = (await db.query(`SELECT id FROM tenants WHERE whatsapp_phone_number_id = $1`, [TENANT_A_PHONE_ID])).rows[0].id as string;
  await db.query(`UPDATE tenants SET timezone = 'Asia/Kuala_Lumpur' WHERE id = $1`, [tenantA]);
  const b = await createTenant({
    businessName: "Glow Salon",
    businessDescription: "A hair and beauty salon in Petaling Jaya.",
    whatsappPhoneNumberId: TENANT_B_PHONE_ID,
  });
  await db.query(`UPDATE tenants SET timezone = 'Asia/Kuala_Lumpur' WHERE id = $1`, [b.id]);

  async function section(tenantId: string, key: SectionKey, raw: unknown) {
    const data = normalizeSection(key, raw);
    if (INDEXED_SECTIONS.includes(key)) {
      await replaceKnowledgeSource(tenantId, knowledgeSourceFor(key), renderIndexedChunks(key, data), (client) =>
        upsertBusinessInfo(client, tenantId, key, data),
      );
    } else {
      await withTenant(tenantId, (client) => upsertBusinessInfo(client, tenantId, key, data));
    }
  }

  // --- A: Kopi Corner ---
  await withTenant(tenantA, (c) =>
    replaceBusinessHours(c, tenantA, [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: "08:00", endTime: "22:00" }))),
  );
  await section(tenantA, "location", {
    address: "12 Jalan Telawi 3, Bangsar Baru, 59100 Kuala Lumpur",
    directions: "Opposite the Maybank, next to the bookshop.",
    phone: "+60 3-2283 1234",
    hoursNotes: "Closed on Hari Raya Aidilfitri (first two days).",
    serviceArea: "",
    email: "",
    website: "",
    socials: "",
  });
  await section(tenantA, "products", {
    items: [
      { name: "Latte", price: "RM 9.50", description: "Double shot, fresh milk. Oat milk +RM 2." },
      { name: "Teh Tarik", price: "RM 4.50", description: "Pulled milk tea, hot or iced." },
      { name: "Nasi Lemak Special", price: "RM 15.00", description: "With fried chicken, sambal, egg and peanuts." },
      { name: "Kaya Toast Set", price: "RM 7.90", description: "Two slices with half-boiled eggs and a kopi." },
    ],
    notes: "All prices include SST.",
  });
  await section(tenantA, "policies", {
    payment: "Cash, card, Touch 'n Go eWallet and DuitNow QR.",
    delivery: "Delivery via GrabFood and Foodpanda only, within 5 km.",
    returns: "Wrong or unsatisfactory orders are replaced on the spot; refunds at the manager's discretion.",
    cancellation: "Table bookings can be cancelled or moved free of charge up to 2 hours before.",
    warranty: "",
    other: "Pets are welcome in the outdoor seating area only.",
  });
  await section(tenantA, "faqs", {
    items: [
      { question: "Do you have wifi?", answer: "Yes, free wifi. Network: KopiCorner, password: kopi2026." },
      { question: "Is there parking?", answer: "Street parking on Jalan Telawi (RM 1/hour) or Bangsar Village basement." },
      { question: "Is the food halal?", answer: "We use halal-certified ingredients but the cafe itself is not JAKIM certified." },
    ],
  });
  await section(tenantA, "assistant", { tone: "friendly", languages: "English, Bahasa Melayu, Chinese", instructions: "" });
  const table = await withTenant(tenantA, (c) => createService(c, tenantA, "Table reservation", 60, 2));
  const room = await withTenant(tenantA, (c) => createService(c, tenantA, "Private room", 120, 1));
  await withTenant(tenantA, (c) =>
    createDocument(c, tenantA, {
      name: "Menu",
      description: "Full food and drinks menu with prices",
      filename: "kopi-corner-menu.pdf",
      mimeType: "application/pdf",
      fileData: fs.readFileSync(path.join(ROOT, "e2e/fixtures/menu.pdf")),
    }),
  );

  // --- B: Glow Salon ---
  await withTenant(b.id, (c) =>
    replaceBusinessHours(c, b.id, [2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: "10:00", endTime: "19:00" }))),
  );
  await section(b.id, "location", { address: "8 Jalan SS2/24, Petaling Jaya", directions: "", phone: "", hoursNotes: "Closed Sunday and Monday.", serviceArea: "", email: "", website: "", socials: "" });
  await section(b.id, "products", { items: [{ name: "Women's haircut", price: "RM 65", description: "Wash, cut and blow-dry." }], notes: "" });
  await section(b.id, "faqs", { items: [{ question: "Is there parking?", answer: "Free parking in the basement, levels B1-B2." }] });
  await withTenant(b.id, (c) => createService(c, b.id, "Haircut", 45, 1));

  return { tenantA, tenantB: b.id, tableServiceId: table.id, roomServiceId: room.id };
}
