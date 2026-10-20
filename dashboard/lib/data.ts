import { cache } from "react";
import { backendFetch } from "./backend";
import { POLICY_FIELDS } from "./policies";

// Typed wrappers around the backend's /api/* routes. Wrapped in React's
// cache() so the layout and a page can both ask for e.g. /api/me in the same
// render without a second round-trip.

export interface Me {
  tenantId: string;
  email: string;
  role: string;
  isAdmin: boolean;
  businessName: string;
  whatsappPhoneNumberId: string;
}

export type ConversationStatus = "bot" | "flagged" | "needs_human" | "human_active";

export { needsAttention } from "./status";

export interface ConversationSummary {
  id: string;
  waNumber: string;
  status: ConversationStatus;
  lastMessageAt: string;
  lastMessage: string | null;
  lastMessageDirection: "in" | "out" | null;
}

export interface KnowledgeChunk {
  id: string;
  content: string;
  source: string | null;
  createdAt: string;
}

export interface DocumentSummary {
  id: string;
  name: string;
  description: string | null;
  filename: string;
  mimeType: string;
  createdAt: string;
}

export interface Service {
  id: string;
  name: string;
  durationMinutes: number;
  capacity: number;
}

export interface BusinessHoursInterval {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface Booking {
  id: string;
  serviceName: string | null;
  contactWaNumber: string;
  contactName: string | null;
  startsAt: string;
  endsAt: string;
  status: "confirmed" | "cancelled";
}

export interface GoogleStatus {
  connected: boolean;
  connectedEmail: string | null;
}

// Mirrors the backend's lib/businessInfo.ts section shapes.
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
export { POLICY_FIELDS };
export type PolicyKey = (typeof POLICY_FIELDS)[number]["key"];
export type PoliciesData = Record<PolicyKey, string>;
export interface FaqItem {
  question: string;
  answer: string;
}
export interface FaqsData {
  items: FaqItem[];
}
export const ASSISTANT_TONES = [
  { value: "friendly", label: "Friendly", description: "Warm, like a helpful staff member" },
  { value: "professional", label: "Professional", description: "Polite, clear, no slang" },
  { value: "casual", label: "Casual", description: "Relaxed, like texting a friend" },
  { value: "concise", label: "Concise", description: "As short as possible" },
] as const;
export interface AssistantData {
  tone: (typeof ASSISTANT_TONES)[number]["value"];
  languages: string;
  instructions: string;
}

export interface SectionMap {
  profile: ProfileData;
  location: LocationData;
  products: ProductsData;
  policies: PoliciesData;
  faqs: FaqsData;
  assistant: AssistantData;
}
export type SectionKey = keyof SectionMap;

export interface BusinessInfo {
  businessName: string;
  businessDescription: string;
  sections: { [K in SectionKey]?: { data: SectionMap[K]; updatedAt: string } };
}

export type TemplateStatus = "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED" | "IN_APPEAL" | "PENDING_DELETION" | "DELETED" | "LIMIT_EXCEEDED";
export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export type TemplateButton =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string; example?: string[] }
  | { type: "PHONE_NUMBER"; text: string; phone_number: string }
  | { type: string; text: string };

export interface TemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION";
  text?: string;
  example?: { header_text?: string[]; body_text?: string[][] };
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

/** `wabaId: null` = this business has no WhatsApp Business Account linked yet (set on the admin page). */
export interface TemplatesResponse {
  wabaId: string | null;
  templates: MessageTemplate[];
  reminderTemplateName: string;
}

// Website / social media import (backend lib/businessImport.ts): a draft in
// the Knowledge pages' own shapes, applied only after the owner reviews it.
export const IMPORT_PARTS = ["profile", "location", "hours", "products", "policies", "faqs"] as const;
export type ImportPart = (typeof IMPORT_PARTS)[number];

export interface ImportDraft {
  businessDescription: string;
  profile: ProfileData;
  location: LocationData;
  hours: BusinessHoursInterval[];
  products: ProductItem[];
  policies: PoliciesData;
  faqs: FaqItem[];
}

export interface ImportState {
  status: "running" | "done" | "failed";
  urls: string[];
  startedAt: string;
  finishedAt?: string;
  step?: string;
  sources?: { label: string; url?: string; ok: boolean; note?: string }[];
  draft?: ImportDraft;
  error?: string;
}

export const getMe = cache(() => backendFetch<Me>("/api/me"));
export const getImportState = cache(() => backendFetch<{ import: ImportState | null }>("/api/import").then((r) => r.import));
export const getSettings = cache(() => backendFetch<{ timezone: string; bookingMinNoticeMinutes: number }>("/api/settings"));
export const getConversations = cache(() => backendFetch<ConversationSummary[]>("/api/conversations"));
export const getBusinessInfo = cache(() => backendFetch<BusinessInfo>("/api/business-info"));
export const getKnowledgeChunks = cache(() => backendFetch<KnowledgeChunk[]>("/api/knowledge"));
export const getDocuments = cache(() => backendFetch<DocumentSummary[]>("/api/documents"));
export const getServices = cache(() => backendFetch<Service[]>("/api/services"));
export const getBusinessHours = cache(() => backendFetch<BusinessHoursInterval[]>("/api/business-hours"));
export const getBookings = cache(() => backendFetch<Booking[]>("/api/bookings"));
export const getGoogleStatus = cache(() => backendFetch<GoogleStatus>("/api/google/status"));
export const getTemplates = cache(() => backendFetch<TemplatesResponse>("/api/templates"));

// --- Setup progress: one source of truth for the Overview checklist and the
// Knowledge section nav's completion dots. ---

export interface SetupStep {
  key: string;
  title: string;
  description: string;
  href: string;
  done: boolean;
  optional?: boolean;
}

export function buildSetupSteps(input: {
  info: BusinessInfo;
  hours: BusinessHoursInterval[];
  documents: DocumentSummary[];
  google: GoogleStatus;
  services: Service[];
}): SetupStep[] {
  const { info, hours, documents, google, services } = input;
  const s = info.sections;
  const location = s.location?.data;
  const policies = s.policies?.data;
  return [
    {
      key: "profile",
      title: "Describe your business",
      description: "What you do, in a few sentences — the assistant's starting point for every reply.",
      href: "/knowledge/profile",
      done: info.businessDescription.trim().length > 0,
    },
    {
      key: "location",
      title: "Add contact details & opening hours",
      description: "Address, phone and weekly hours — the questions customers ask most.",
      href: "/knowledge/location",
      done: !!(location && (location.address || location.phone)) && hours.length > 0,
    },
    {
      key: "products",
      title: "List your products or services",
      description: "Names and prices, so the assistant can quote them accurately.",
      href: "/knowledge/products",
      done: (s.products?.data.items.length ?? 0) > 0,
    },
    {
      key: "policies",
      title: "Set your policies",
      description: "Payment, delivery, refunds, cancellations.",
      href: "/knowledge/policies",
      done: !!policies && Object.values(policies).some((v) => v.trim()),
    },
    {
      key: "faqs",
      title: "Answer common questions",
      description: "Anything customers ask that isn't covered above.",
      href: "/knowledge/faqs",
      done: (s.faqs?.data.items.length ?? 0) > 0,
    },
    {
      key: "files",
      title: "Upload a menu or price list",
      description: "Files the assistant can send on request.",
      href: "/knowledge/files",
      done: documents.length > 0,
      optional: true,
    },
    {
      key: "assistant",
      title: "Choose your assistant's voice",
      description: "Tone, languages and any special instructions.",
      href: "/settings/assistant",
      done: !!s.assistant,
      optional: true,
    },
    {
      key: "bookings",
      title: "Turn on bookings",
      description: "Add a bookable service and connect Google Calendar.",
      href: "/bookings/setup",
      done: services.length > 0 && google.connected,
      optional: true,
    },
  ];
}
