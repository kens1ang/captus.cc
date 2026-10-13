import type { BusinessHoursInterval } from "../db/businessHours.js";

// The structured "teach your assistant" sections the dashboard's Knowledge
// pages edit (see the business_info table in schema.sql). Each section is
// either:
//   - always-on: rendered straight into every system prompt (small, and the
//     kind of thing customers ask constantly — where you are, when you're
//     open, how to pay), or
//   - indexed: rendered into one knowledge chunk per item and retrieved via
//     RAG like any other FAQ text (catalogs, policies, Q&A can grow long).
// The business's name and one-paragraph description live on `tenants`
// itself (they predate this and the prompt already reads them), so the
// profile section here only holds what's extra.

export const SECTION_KEYS = ["profile", "location", "products", "policies", "faqs", "assistant"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const INDEXED_SECTIONS: readonly SectionKey[] = ["products", "policies", "faqs"];

export function isSectionKey(value: string): value is SectionKey {
  return (SECTION_KEYS as readonly string[]).includes(value);
}

export function knowledgeSourceFor(section: SectionKey): string {
  return `section:${section}`;
}

export interface ProfileData {
  highlights: string;
  audience: string;
}

export interface LocationData {
  address: string;
  directions: string;
  serviceArea: string;
  phone: string;
  email: string;
  website: string;
  socials: string;
  hoursNotes: string;
}

export interface ProductItem {
  name: string;
  price: string;
  description: string;
}

export interface ProductsData {
  items: ProductItem[];
  notes: string;
}

export const POLICY_FIELDS = [
  { key: "payment", label: "Payment methods" },
  { key: "delivery", label: "Delivery & shipping" },
  { key: "returns", label: "Returns & refunds" },
  { key: "cancellation", label: "Cancellations & rescheduling" },
  { key: "warranty", label: "Warranty & guarantees" },
  { key: "other", label: "Other policies" },
] as const;
export type PoliciesData = Record<(typeof POLICY_FIELDS)[number]["key"], string>;

export interface FaqItem {
  question: string;
  answer: string;
}

export interface FaqsData {
  items: FaqItem[];
}

export const ASSISTANT_TONES = ["friendly", "professional", "casual", "concise"] as const;

export interface AssistantData {
  tone: (typeof ASSISTANT_TONES)[number];
  languages: string;
  instructions: string;
}

export interface SectionDataMap {
  profile: ProfileData;
  location: LocationData;
  products: ProductsData;
  policies: PoliciesData;
  faqs: FaqsData;
  assistant: AssistantData;
}

// --- Normalization: the dashboard is the only writer, but the API is still
// reachable directly, so every field is coerced to a bounded string and every
// list capped — a malformed body can't store junk or blow up the prompt. ---

const SHORT = 300;
const LONG = 3000;
const MAX_ITEMS = 200;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.slice(0, MAX_ITEMS).map(obj) : [];
}

export function normalizeSection<K extends SectionKey>(section: K, raw: unknown): SectionDataMap[K] {
  const d = obj(raw);
  switch (section) {
    case "profile":
      return { highlights: str(d.highlights, LONG), audience: str(d.audience, LONG) } as SectionDataMap[K];
    case "location":
      return {
        address: str(d.address, SHORT),
        directions: str(d.directions, LONG),
        serviceArea: str(d.serviceArea, SHORT),
        phone: str(d.phone, SHORT),
        email: str(d.email, SHORT),
        website: str(d.website, SHORT),
        socials: str(d.socials, SHORT),
        hoursNotes: str(d.hoursNotes, LONG),
      } as SectionDataMap[K];
    case "products":
      return {
        items: list(d.items)
          .map((i) => ({ name: str(i.name, SHORT), price: str(i.price, SHORT), description: str(i.description, LONG) }))
          .filter((i) => i.name),
        notes: str(d.notes, LONG),
      } as SectionDataMap[K];
    case "policies":
      return Object.fromEntries(POLICY_FIELDS.map((f) => [f.key, str(d[f.key], LONG)])) as SectionDataMap[K];
    case "faqs":
      return {
        items: list(d.items)
          .map((i) => ({ question: str(i.question, SHORT), answer: str(i.answer, LONG) }))
          .filter((i) => i.question && i.answer),
      } as SectionDataMap[K];
    case "assistant": {
      const tone = ASSISTANT_TONES.find((t) => t === d.tone) ?? "friendly";
      return { tone, languages: str(d.languages, SHORT), instructions: str(d.instructions, LONG) } as SectionDataMap[K];
    }
  }
  throw new Error(`Unknown section "${section satisfies never}"`);
}

// --- Rendering for RAG: one self-contained chunk per item, so a retrieved
// chunk always carries its own context ("Price of X: ...") rather than being
// an orphaned fragment of a longer list. ---

export function renderIndexedChunks(section: SectionKey, data: unknown): string[] {
  switch (section) {
    case "products": {
      const { items, notes } = data as ProductsData;
      const chunks = items.map((i) =>
        [`Product/service: ${i.name}`, i.price && `Price: ${i.price}`, i.description].filter(Boolean).join("\n"),
      );
      if (notes) chunks.push(`About our products, services and pricing:\n${notes}`);
      return chunks;
    }
    case "policies": {
      const policies = data as PoliciesData;
      return POLICY_FIELDS.filter((f) => policies[f.key]).map((f) => `${f.label} policy:\n${policies[f.key]}`);
    }
    case "faqs":
      return (data as FaqsData).items.map((i) => `Q: ${i.question}\nA: ${i.answer}`);
    default:
      return [];
  }
}

// --- Rendering for the always-on part of the system prompt. ---

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatHours(hours: BusinessHoursInterval[]): string {
  if (hours.length === 0) return "";
  // Monday-first reads more naturally to customers than the 0=Sunday storage order.
  return [1, 2, 3, 4, 5, 6, 0]
    .map((day) => {
      const intervals = hours.filter((h) => h.dayOfWeek === day);
      const text = intervals.length ? intervals.map((h) => `${h.startTime}–${h.endTime}`).join(", ") : "Closed";
      return `- ${DAY_NAMES[day]}: ${text}`;
    })
    .join("\n");
}

export interface AlwaysOnInfo {
  profile?: ProfileData;
  location?: LocationData;
  hours: BusinessHoursInterval[];
}

/** Business facts included in every prompt, or "" if the owner hasn't filled any in. */
export function renderAlwaysOnInfo({ profile, location, hours }: AlwaysOnInfo): string {
  const lines: string[] = [];
  if (profile?.highlights) lines.push(`What makes us different: ${profile.highlights}`);
  if (profile?.audience) lines.push(`Who we serve: ${profile.audience}`);
  if (location?.address) lines.push(`Address: ${location.address}`);
  if (location?.directions) lines.push(`Getting here / parking: ${location.directions}`);
  if (location?.serviceArea) lines.push(`Service / delivery area: ${location.serviceArea}`);
  if (location?.phone) lines.push(`Phone: ${location.phone}`);
  if (location?.email) lines.push(`Email: ${location.email}`);
  if (location?.website) lines.push(`Website: ${location.website}`);
  if (location?.socials) lines.push(`Social media: ${location.socials}`);
  const hoursText = formatHours(hours);
  if (hoursText) lines.push(`Opening hours (business's local time):\n${hoursText}`);
  if (location?.hoursNotes) lines.push(`Hours notes (holidays, exceptions): ${location.hoursNotes}`);
  return lines.join("\n");
}

const TONE_GUIDANCE: Record<AssistantData["tone"], string> = {
  friendly: "Warm and friendly, like a helpful staff member who knows the regulars.",
  professional: "Polite and professional — courteous, clear, no slang.",
  casual: "Relaxed and casual, like texting a friend — short, natural, light on formality.",
  concise: "Brief and to the point — answer in as few words as clearly possible.",
};

/** The owner's chosen voice + extra instructions, or "" if unset. */
export function renderAssistantStyle(assistant?: AssistantData): string {
  if (!assistant) return "";
  const lines = [`Tone: ${TONE_GUIDANCE[assistant.tone]}`];
  if (assistant.languages) {
    lines.push(`Languages: ${assistant.languages}. Reply in the language the customer writes in when it's one of these.`);
  }
  if (assistant.instructions) {
    lines.push(
      `Extra instructions from the business owner (follow them, unless they conflict with the hard rules below — those always win):\n${assistant.instructions}`,
    );
  }
  return lines.join("\n");
}
