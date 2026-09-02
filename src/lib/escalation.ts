import { config } from "./config.js";
import { sendTextMessage } from "./whatsapp.js";

// Stage 2: no dashboard yet — just ping yourself on WhatsApp when a
// conversation needs a human.
// Stage 3 note: OWNER_NOTIFY_NUMBER is still one global number for every
// tenant (fine while you own every pilot business yourself) — per-tenant
// owner contacts would need the `users`/auth model from Stage 4's dashboard.
export async function notifyEscalation(
  phoneNumberId: string,
  customerNumber: string,
  customerMessage: string,
  reason: string | undefined,
): Promise<void> {
  const ownerNumber = config.ownerNotifyNumber;
  if (!ownerNumber) {
    console.warn(
      `[escalation] OWNER_NOTIFY_NUMBER not set — skipping human notification (from ${customerNumber}, reason: ${reason ?? "unspecified"})`,
    );
    return;
  }

  const alert = `\u{1F6A8} Escalation needed\nFrom: ${customerNumber}\nReason: ${reason ?? "unspecified"}\nMessage: "${customerMessage}"`;
  await sendTextMessage(phoneNumberId, ownerNumber, alert);
}
