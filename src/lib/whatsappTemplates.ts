import { config } from "./config.js";

// Message templates live on the WhatsApp Business Account (WABA), not on a
// phone number, and Meta is the single source of truth for them: the
// dashboard reads them live from the Graph API instead of keeping a local
// copy, so templates created or edited directly in WhatsApp Manager show up
// here too and there's no sync state to drift. Creating one submits it for
// Meta's review automatically — there's no separate "submit" call.

const GRAPH_API_VERSION = "v21.0";
const GRAPH = `${config.whatsapp.graphBase}/${GRAPH_API_VERSION}`;

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";
export type TemplateStatus = "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED" | "IN_APPEAL" | "PENDING_DELETION" | "DELETED" | "LIMIT_EXCEEDED";

export type TemplateButton =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string; example?: string[] }
  | { type: "PHONE_NUMBER"; text: string; phone_number: string };

export interface TemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION";
  text?: string;
  example?: { header_text?: string[]; body_text?: string[][]; header_handle?: string[] };
  buttons?: TemplateButton[];
}

export interface MessageTemplate {
  id: string;
  name: string;
  language: string;
  status: TemplateStatus;
  category: TemplateCategory;
  components: TemplateComponent[];
  rejected_reason?: string;
  quality_score?: { score?: string };
}

export class MetaApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Meta's errors carry a human-readable `error_user_msg` for validation failures (e.g. "Template name already exists") — prefer it over the generic `message`. */
async function graphFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${config.whatsapp.accessToken}`, "Content-Type": "application/json" },
  });
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string; error_user_title?: string; error_user_msg?: string };
  };
  if (!res.ok) {
    const e = data.error;
    const msg = e?.error_user_msg ? `${e.error_user_title ? `${e.error_user_title}: ` : ""}${e.error_user_msg}` : (e?.message ?? res.statusText);
    throw new MetaApiError(res.status, msg);
  }
  return data;
}

const LIST_FIELDS = "id,name,language,status,category,components,rejected_reason,quality_score";

export async function listTemplates(wabaId: string): Promise<MessageTemplate[]> {
  const all: MessageTemplate[] = [];
  let path: string | null = `/${wabaId}/message_templates?fields=${LIST_FIELDS}&limit=100`;
  // A WABA can hold up to 250 templates (more once verified) — follow paging
  // rather than silently showing only the first page.
  for (let page = 0; path && page < 10; page++) {
    const data: { data: MessageTemplate[]; paging?: { next?: string } } = await graphFetch(path);
    all.push(...data.data);
    path = data.paging?.next ? data.paging.next.replace(GRAPH, "") : null;
  }
  return all;
}

export interface CreateTemplateInput {
  name: string;
  language: string;
  category: Exclude<TemplateCategory, "AUTHENTICATION">;
  components: TemplateComponent[];
}

export async function createTemplate(wabaId: string, input: CreateTemplateInput): Promise<{ id: string; status: TemplateStatus; category: TemplateCategory }> {
  return graphFetch(`/${wabaId}/message_templates`, { method: "POST", body: JSON.stringify(input) });
}

/** Deletes one specific template (this language only) by id — deleting by name alone would remove every language version of it. */
export async function deleteTemplate(wabaId: string, templateId: string, name: string): Promise<void> {
  const params = new URLSearchParams({ hsm_id: templateId, name });
  await graphFetch(`/${wabaId}/message_templates?${params}`, { method: "DELETE" });
}

// --- Validation -------------------------------------------------------------
// Mirrors Meta's own rules so the owner gets an immediate, specific error
// instead of a vague rejection after a round-trip (or worse, after review).

const NAME_RE = /^[a-z0-9_]{1,512}$/;
const LANGUAGE_RE = /^[a-z]{2,3}(_[A-Z]{2})?$/;

function placeholders(text: string): number[] {
  return [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
}

/** {{1}}..{{n}} with no gaps, and not starting/ending the text — both are common rejection reasons. */
function checkPlaceholders(text: string, where: string, examples: string[] | undefined, maxVars: number): string | null {
  const nums = placeholders(text);
  if (/\{\{(?!\s*\d+\s*\}\})/.test(text)) return `${where}: variables must look like {{1}}, {{2}}, …`;
  const unique = [...new Set(nums)].sort((a, b) => a - b);
  if (unique.length > maxVars) return `${where}: at most ${maxVars} variable${maxVars === 1 ? "" : "s"}`;
  if (unique.some((n, i) => n !== i + 1)) return `${where}: number variables in order starting from {{1}} with no gaps`;
  const trimmed = text.trim();
  if (unique.length && (/^\{\{\s*\d+\s*\}\}/.test(trimmed) || /\{\{\s*\d+\s*\}\}$/.test(trimmed))) {
    return `${where}: text can't start or end with a variable — add words before/after it`;
  }
  if (unique.length && (!examples || examples.length !== unique.length || examples.some((e) => !e.trim()))) {
    return `${where}: give a sample value for each variable`;
  }
  return null;
}

/** Returns an error message, or null if the template looks valid. */
export function validateTemplateInput(input: CreateTemplateInput): string | null {
  if (!NAME_RE.test(input.name)) return "Name: use only lowercase letters, numbers and underscores (e.g. order_update)";
  if (!LANGUAGE_RE.test(input.language)) return "Pick a language";
  if (input.category !== "MARKETING" && input.category !== "UTILITY") return "Category must be Marketing or Utility";

  const header = input.components.find((c) => c.type === "HEADER");
  const body = input.components.find((c) => c.type === "BODY");
  const footer = input.components.find((c) => c.type === "FOOTER");
  const buttons = input.components.find((c) => c.type === "BUTTONS")?.buttons ?? [];

  if (!body?.text?.trim()) return "Body text is required";
  if (body.text.length > 1024) return "Body: max 1024 characters";
  const bodyErr = checkPlaceholders(body.text, "Body", body.example?.body_text?.[0], 20);
  if (bodyErr) return bodyErr;

  if (header) {
    if (header.format !== "TEXT" || !header.text?.trim()) return "Header: only text headers are supported";
    if (header.text.length > 60) return "Header: max 60 characters";
    const headerErr = checkPlaceholders(header.text, "Header", header.example?.header_text, 1);
    if (headerErr) return headerErr;
  }

  if (footer) {
    if (!footer.text?.trim()) return "Footer text is empty";
    if (footer.text.length > 60) return "Footer: max 60 characters";
    if (placeholders(footer.text).length) return "Footer can't contain variables";
  }

  if (buttons.length > 10) return "At most 10 buttons";
  if (buttons.filter((b) => b.type === "URL").length > 2) return "At most 2 website buttons";
  if (buttons.filter((b) => b.type === "PHONE_NUMBER").length > 1) return "At most 1 call button";
  for (const b of buttons) {
    if (!b.text.trim() || b.text.length > 25) return "Button text is required (max 25 characters)";
    if (b.type === "URL" && !/^https?:\/\/\S+$/.test(b.url)) return `Button "${b.text}": enter a full URL starting with https://`;
    if (b.type === "PHONE_NUMBER" && !/^\+\d{7,15}$/.test(b.phone_number)) return `Button "${b.text}": phone number must be in international format, e.g. +60123456789`;
  }
  // Meta requires quick replies to be grouped together, not interleaved with
  // URL/phone buttons.
  const kinds = buttons.map((b) => (b.type === "QUICK_REPLY" ? "q" : "c")).join("");
  if (/q+c+q|c+q+c/.test(kinds)) return "Keep quick-reply buttons together (all before or all after the link/call buttons)";

  return null;
}
