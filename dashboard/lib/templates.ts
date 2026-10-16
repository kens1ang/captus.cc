import type { MessageTemplate, TemplateStatus } from "./data";

/** Languages offered in the editor — the ones Captus's Malaysian/SEA clients actually use, not Meta's full list of 70+. */
export const TEMPLATE_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "en_US", label: "English (US)" },
  { code: "en_GB", label: "English (UK)" },
  { code: "ms", label: "Malay" },
  { code: "zh_CN", label: "Chinese (Simplified)" },
  { code: "zh_HK", label: "Chinese (Hong Kong)" },
  { code: "zh_TW", label: "Chinese (Traditional)" },
  { code: "ta", label: "Tamil" },
  { code: "id", label: "Indonesian" },
  { code: "th", label: "Thai" },
  { code: "vi", label: "Vietnamese" },
  { code: "fil", label: "Filipino" },
] as const;

export function languageLabel(code: string): string {
  return TEMPLATE_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

export const STATUS_DISPLAY: Record<TemplateStatus, { label: string; tone: "brand" | "warn" | "danger" | "neutral" }> = {
  APPROVED: { label: "Approved", tone: "brand" },
  PENDING: { label: "In review", tone: "warn" },
  IN_APPEAL: { label: "In appeal", tone: "warn" },
  REJECTED: { label: "Rejected", tone: "danger" },
  PAUSED: { label: "Paused", tone: "danger" },
  DISABLED: { label: "Disabled", tone: "danger" },
  LIMIT_EXCEEDED: { label: "Limit exceeded", tone: "danger" },
  PENDING_DELETION: { label: "Deleting", tone: "neutral" },
  DELETED: { label: "Deleted", tone: "neutral" },
};

/** Statuses that Meta will change on its own soon — the list page keeps polling while any template is in one. */
export function isSettling(status: TemplateStatus): boolean {
  return status === "PENDING" || status === "IN_APPEAL" || status === "PENDING_DELETION";
}

/** Meta's rejection codes, in words a business owner can act on. */
const REJECTION_HELP: Record<string, string> = {
  INVALID_FORMAT: "The format isn't valid — check variables and button text.",
  TAG_CONTENT_MISMATCH: "The content doesn't match the category. Promotional wording belongs in Marketing.",
  ABUSIVE_CONTENT: "Meta flagged the content as violating its policies.",
  INCORRECT_CATEGORY: "Wrong category for this content.",
  PROMOTIONAL: "Contains promotional content — submit it as Marketing.",
  SCAM: "Meta flagged it as potentially misleading.",
};

export function rejectionText(reason: string | undefined): string | null {
  if (!reason || reason === "NONE") return null;
  return REJECTION_HELP[reason] ?? reason.replaceAll("_", " ").toLowerCase();
}

/** Pulls the previewable parts out of Meta's component list. */
export function previewParts(t: MessageTemplate) {
  const header = t.components.find((c) => c.type === "HEADER");
  const body = t.components.find((c) => c.type === "BODY");
  const footer = t.components.find((c) => c.type === "FOOTER");
  const buttons = t.components.find((c) => c.type === "BUTTONS")?.buttons ?? [];
  return {
    header: header?.format === "TEXT" ? header.text : undefined,
    headerSample: header?.example?.header_text?.[0],
    mediaHeader: header && header.format !== "TEXT" ? header.format : undefined,
    body: body?.text ?? "",
    bodySamples: body?.example?.body_text?.[0],
    footer: footer?.text,
    buttons: buttons.map((b) => ({ type: b.type, text: b.text })),
  };
}
