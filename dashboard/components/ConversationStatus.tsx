import { Badge } from "./ui";
import type { ConversationStatus } from "@/lib/data";

export const STATUS_META: Record<ConversationStatus, { label: string; tone: "brand" | "warn" | "info" }> = {
  bot: { label: "Assistant", tone: "brand" },
  needs_human: { label: "Needs you", tone: "warn" },
  human_active: { label: "You're replying", tone: "info" },
};

export function StatusBadge({ status }: { status: ConversationStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

/** Initials-free avatar for a phone number — last two digits on a tinted circle, colour stable per number. */
export function ContactAvatar({ waNumber, size = "md" }: { waNumber: string; size?: "sm" | "md" }) {
  const digits = waNumber.replace(/\D/g, "");
  const hue = [...digits].reduce((h, d) => (h * 31 + Number(d)) % 360, 7);
  return (
    <div
      className={
        size === "sm"
          ? "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
          : "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
      }
      style={{ background: `hsl(${hue} 60% 50% / 0.15)`, color: `hsl(${hue} 55% 42%)` }}
    >
      {digits.slice(-2)}
    </div>
  );
}
