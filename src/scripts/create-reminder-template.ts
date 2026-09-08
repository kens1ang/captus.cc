// One-time setup: creates the WhatsApp message template booking reminders
// are sent through (src/lib/bookingReminders.ts, src/worker.ts's
// reminderWorker) — required because a reminder sent hours ahead of an
// appointment is almost always outside the 24h customer-service window,
// where only a pre-approved template (not plain text) can be sent.
//
// Usage: npm run create-reminder-template -- <whatsapp-business-account-id>
// Find the WABA id in Meta Business Suite > WhatsApp Manager > API Setup,
// next to your phone number id.
//
// Meta typically reviews/approves a simple UTILITY-category template like
// this within minutes, sometimes instantly — check status with:
//   GET https://graph.facebook.com/v21.0/{WABA_ID}/message_templates?name=booking_reminder
// (or just check WhatsApp Manager > Account tools > Message templates in the UI).
import { config } from "../lib/config.js";
import { REMINDER_TEMPLATE_NAME, REMINDER_TEMPLATE_LANGUAGE } from "../lib/bookingReminders.js";

const GRAPH_API_VERSION = "v21.0";

async function main() {
  const [wabaId] = process.argv.slice(2);
  if (!wabaId) {
    console.error("Usage: npm run create-reminder-template -- <whatsapp-business-account-id>");
    process.exit(1);
  }

  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: REMINDER_TEMPLATE_NAME,
      language: REMINDER_TEMPLATE_LANGUAGE,
      category: "UTILITY",
      components: [
        {
          type: "BODY",
          text: "Reminder: you have a {{1}} appointment scheduled for {{2}}. Reply here if you'd like to reschedule or cancel.",
          example: { body_text: [["Consultation", "Tue 9 Sep, 2:30 PM - 3:00 PM"]] },
        },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error(`Template creation failed (${res.status}):`, JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log(`Template "${REMINDER_TEMPLATE_NAME}" submitted:`, JSON.stringify(data, null, 2));
  console.log("");
  console.log(
    "Status starts PENDING — check WhatsApp Manager > Account tools > Message templates, or re-run this GET:\n" +
      `  https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates?name=${REMINDER_TEMPLATE_NAME}`,
  );
  console.log("Reminders won't actually send until this shows APPROVED.");
}

main().catch((err) => {
  console.error("Template creation failed:", err);
  process.exit(1);
});
