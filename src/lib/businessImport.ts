import { connection, businessImportQueue, type BusinessImportJob } from "./queue.js";
import { config } from "./config.js";
import { safeFetch } from "./safeFetch.js";
import { htmlToText, type PageText } from "./htmlText.js";
import { extractStructured, searchWeb } from "./gemini.js";
import { saveBusinessSection } from "./businessInfoStore.js";
import { normalizeSection, POLICY_FIELDS, type FaqItem, type LocationData, type PoliciesData, type ProductItem, type ProfileData } from "./businessInfo.js";
import { withTenant } from "../db/tenantContext.js";
import { getTenantById, updateTenantProfile } from "../db/tenants.js";
import { listBusinessInfo } from "../db/businessInfo.js";
import { listBusinessHours, replaceBusinessHours, type BusinessHoursInterval } from "../db/businessHours.js";

// "Fill in my Knowledge from my website and social media." The owner gives a
// few links (at signup or on the Knowledge overview); a background job reads
// them and has Gemini turn what it finds into a DRAFT in the Knowledge
// pages' own shape. Nothing is written to Knowledge until the owner reviews
// the draft and applies it — and applying only fills what's still empty
// (and appends new products/FAQs), never overwrites what they wrote.
//
// What can be read, honestly:
// - Their website: yes — the homepage plus the few pages most likely to
//   hold prices, hours, contact details, FAQs and policies.
// - Instagram / Facebook / TikTok: only the public link-preview bio. Their
//   posts sit behind a login wall, and scraping past it breaks their terms.
// - Google Search (grounded Gemini): finds the Google Maps listing (address,
//   hours, phone) and whatever Google has indexed from their socials. Needs
//   a paid Gemini key — free keys have zero grounding quota, so on those
//   this step is skipped and the import runs on the links alone.
//
// Typical run: 15–40 s (pages are fetched in parallel; the Gemini
// extraction is most of it). The owner isn't blocked meanwhile.

const MAX_URLS = 5;
const MAX_EXTRA_PAGES = 5;
const MAX_IMPORTS_PER_DAY = 10;
const STATE_TTL_SECONDS = 7 * 24 * 3600;
// A job that's been "running" this long died with the process (deploy, OOM).
const STALE_RUNNING_MS = 5 * 60_000;

const stateKey = (tenantId: string) => `import:${tenantId}`;

export interface ImportDraft {
  businessDescription: string;
  profile: ProfileData;
  location: LocationData;
  hours: BusinessHoursInterval[];
  products: ProductItem[];
  policies: PoliciesData;
  faqs: FaqItem[];
}

export interface ImportSource {
  label: string;
  url?: string;
  ok: boolean;
  note?: string;
}

export interface ImportState {
  status: "running" | "done" | "failed";
  urls: string[];
  startedAt: string;
  finishedAt?: string;
  step?: string;
  sources?: ImportSource[];
  draft?: ImportDraft;
  error?: string;
}

async function writeState(tenantId: string, state: ImportState): Promise<void> {
  await connection.set(stateKey(tenantId), JSON.stringify(state), "EX", STATE_TTL_SECONDS);
}

export async function getImportState(tenantId: string): Promise<ImportState | null> {
  const raw = await connection.get(stateKey(tenantId));
  if (!raw) return null;
  const state = JSON.parse(raw) as ImportState;
  if (state.status === "running" && Date.now() - Date.parse(state.startedAt) > STALE_RUNNING_MS) {
    return { ...state, status: "failed", error: "The import was interrupted. Please try again." };
  }
  return state;
}

export async function dismissImport(tenantId: string): Promise<void> {
  await connection.del(stateKey(tenantId));
}

// --- Links ------------------------------------------------------------------

const SOCIAL_HOSTS: { pattern: RegExp; label: string }[] = [
  { pattern: /(^|\.)instagram\.com$/, label: "Instagram" },
  { pattern: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/, label: "Facebook" },
  { pattern: /(^|\.)tiktok\.com$/, label: "TikTok" },
  { pattern: /(^|\.)(x\.com|twitter\.com)$/, label: "X" },
  { pattern: /(^|\.)linkedin\.com$/, label: "LinkedIn" },
  { pattern: /(^|\.)youtube\.com$|^youtu\.be$/, label: "YouTube" },
  { pattern: /(^|\.)(xiaohongshu\.com|xhslink\.com)$/, label: "Xiaohongshu" },
  { pattern: /(^|\.)(shopee\.com\.my|shopee\.sg|lazada\.com\.my|lazada\.sg|grab\.com|foodpanda\.my)$/, label: "Marketplace" },
  { pattern: /^(maps\.app\.goo\.gl|goo\.gl|g\.page|maps\.google\.com)$|(^|\.)google\.com$/, label: "Google Maps" },
  { pattern: /^(wa\.me|api\.whatsapp\.com)$/, label: "WhatsApp" },
];

function socialLabel(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  return SOCIAL_HOSTS.find((s) => s.pattern.test(host))?.label ?? null;
}

/** Owner-typed links → clean absolute URLs ("glowbeauty.my" → "https://glowbeauty.my/"), deduped, capped. Throws on junk. */
export function normalizeUrls(raw: unknown): string[] {
  const items = (Array.isArray(raw) ? raw : [raw])
    .flatMap((v) => (typeof v === "string" ? v.split(/[\s,]+/) : []))
    .map((v) => v.trim())
    .filter(Boolean);
  const urls: string[] = [];
  for (const item of items) {
    // "@glowbeauty" alone is ambiguous between platforms — ask for the link.
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(item) ? item : `https://${item}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      throw new Error(`"${item}" isn't a link we can read`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`"${item}" isn't a web link`);
    if (!url.hostname.includes(".")) throw new Error(`"${item}" isn't a full web address`);
    url.hash = "";
    if (!urls.includes(url.toString())) urls.push(url.toString());
  }
  if (urls.length === 0) throw new Error("Add your website or at least one social media link");
  if (urls.length > MAX_URLS) throw new Error(`Up to ${MAX_URLS} links at a time`);
  return urls;
}

// --- Starting -----------------------------------------------------------------

export class ImportRejectedError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function startImport(tenantId: string, urls: string[]): Promise<ImportState> {
  const current = await getImportState(tenantId);
  if (current?.status === "running") throw new ImportRejectedError(409, "An import is already running");

  const rateKey = `import:rate:${tenantId}`;
  const count = await connection.incr(rateKey);
  if (count === 1) await connection.expire(rateKey, 24 * 3600);
  if (count > MAX_IMPORTS_PER_DAY) throw new ImportRejectedError(429, `Up to ${MAX_IMPORTS_PER_DAY} imports a day — try again tomorrow`);

  const state: ImportState = { status: "running", urls, startedAt: new Date().toISOString(), step: "Starting…" };
  await writeState(tenantId, state);
  await businessImportQueue.add("import", { tenantId, urls }, { jobId: `import-${tenantId}-${Date.now()}` });
  return state;
}

// --- Reading the sources ----------------------------------------------------

// Pages most likely to hold what the Knowledge pages ask for, best first.
const PAGE_HINTS: [RegExp, number][] = [
  [/menu|price|pricing|rate|package|harga|收费|价格|菜单/i, 6],
  [/service|treatment|product|shop|catalog|collection|course|class/i, 5],
  [/contact|location|find-us|visit|hubungi|联系/i, 5],
  [/faq|question|help|soalan/i, 4],
  [/about|story|tentang|关于/i, 3],
  [/polic|shipping|delivery|refund|return|terms|booking|appointment|reservation/i, 3],
];
const SKIP_PAGE = /\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mp3)(\?|$)|\/(cart|checkout|login|signin|account|wp-admin|tag|author|feed)\b/i;

function pickExtraPages(home: PageText, homeUrl: URL): string[] {
  const host = homeUrl.hostname.replace(/^www\./, "");
  const scored = new Map<string, number>();
  for (const link of home.links) {
    let url: URL;
    try {
      url = new URL(link.href);
    } catch {
      continue;
    }
    if ((url.protocol !== "https:" && url.protocol !== "http:") || SKIP_PAGE.test(url.pathname)) continue;
    const linkHost = url.hostname.replace(/^www\./, "");
    // Same site, including its subdomains — a price list on
    // malaysia.example.com is still this business's own page.
    const sameHost = linkHost === host;
    if (!sameHost && !linkHost.endsWith(`.${host}`) && !host.endsWith(`.${linkHost}`)) continue;
    url.hash = "";
    url.search = "";
    const key = url.toString();
    if (key === homeUrl.toString() || (sameHost && url.pathname === "/")) continue;
    const haystack = `${url.hostname} ${url.pathname} ${link.text}`;
    const score = PAGE_HINTS.reduce((s, [re, w]) => (re.test(haystack) ? s + w : s), 0) + (sameHost ? 1 : 0);
    if (score > 0) scored.set(key, Math.max(score, scored.get(key) ?? 0));
  }
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_EXTRA_PAGES)
    .map(([u]) => u);
}

async function readPage(url: string): Promise<PageText & { finalUrl: string }> {
  const page = await safeFetch(url, { allowPrivate: config.import.allowPrivateHosts });
  if (page.status >= 400) throw new Error(`HTTP ${page.status}`);
  if (!/html|xml|text\/plain/i.test(page.contentType) && page.contentType) throw new Error(`Not a web page (${page.contentType.split(";")[0]})`);
  return { ...htmlToText(page.body, page.url), finalUrl: page.url };
}

function pageBlock(label: string, url: string, page: PageText, maxText: number): string {
  return [
    `### ${label}: ${url}`,
    page.title && `Title: ${page.title}`,
    page.description && `Description: ${page.description}`,
    ...page.structuredData.map((d) => `Structured data: ${d}`),
    maxText > 0 && page.text && `Page text:\n${page.text.slice(0, maxText)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return "Website not found";
  if (/private address/.test(msg)) return "Not a public website";
  if (/Timed out|ETIMEDOUT/.test(msg)) return "Took too long to respond";
  return msg.slice(0, 120);
}

async function gatherWebsite(url: string, sources: ImportSource[], blocks: string[]): Promise<void> {
  let home: Awaited<ReturnType<typeof readPage>>;
  try {
    home = await readPage(url);
  } catch (err) {
    sources.push({ label: "Website", url, ok: false, note: errorText(err) });
    return;
  }
  blocks.push(pageBlock("Website homepage", url, home, 15_000));
  // Where it ended up (example.com → www.example.com, or a site builder's domain) is the site to stay on.
  const extras = pickExtraPages(home, new URL(home.finalUrl));
  const results = await Promise.allSettled(extras.map((u) => readPage(u)));
  let read = 1;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      read++;
      blocks.push(pageBlock("Website page", extras[i], r.value, 10_000));
    }
  });
  // A homepage that's all JavaScript (some site builders) gives little text — say so.
  const thin = home.text.length < 300 && read === 1;
  sources.push({ label: "Website", url, ok: true, note: thin ? "Very little text could be read from this site" : `${read} page${read === 1 ? "" : "s"} read` });
}

async function gatherLink(url: string, label: string, sources: ImportSource[], blocks: string[]): Promise<void> {
  try {
    const page = await readPage(url);
    const isSocial = label !== "Link";
    // Social pages' visible text is login-wall boilerplate — only their head tags (the public bio) mean anything.
    const block = pageBlock(label, url, page, isSocial ? 0 : 8_000);
    const hasContent = !!(page.description || page.structuredData.length || (!isSocial && page.text.length > 200));
    if (hasContent) blocks.push(block);
    sources.push({ label, url, ok: hasContent, note: hasContent ? (isSocial ? "Public profile info read" : "Page read") : "Nothing public could be read" });
  } catch (err) {
    sources.push({ label, url, ok: false, note: errorText(err) });
  }
}

async function gatherSearch(businessName: string, urls: string[], sources: ImportSource[], blocks: string[]): Promise<void> {
  const prompt = `Use Google Search to find public information about this business, so its customer-service assistant can answer questions.

Business name: ${businessName}
Its own links (use these to make sure you have the right business — ignore other businesses with a similar name):
${urls.map((u) => `- ${u}`).join("\n")}

Report every fact you can find about THIS business: what it does, address, phone, email, opening hours for each day, products or services with prices, payment methods, delivery, booking or cancellation rules, and anything customers commonly ask. Include their Google Maps listing details if found.
Rules: facts you actually found only, never guesses. Keep prices exactly as written (with currency). If you're not sure a result is this business, leave it out. Plain notes, no preamble.`;
  try {
    const text = await searchWeb(prompt);
    blocks.push(`### Google Search results\n${text.slice(0, 12_000)}`);
    sources.push({ label: "Google Search", ok: true, note: "Public listings checked" });
  } catch (err) {
    console.warn("[import] web search skipped:", err instanceof Error ? err.message : err);
    sources.push({ label: "Google Search", ok: false, note: "Not available right now" });
  }
}

// --- Extraction -------------------------------------------------------------

const STR = { type: "STRING" };
const EXTRACT_SCHEMA = {
  type: "OBJECT",
  properties: {
    businessDescription: { type: "STRING", description: "2–4 sentences: what the business does, written as the business ('We are…'). Empty if unknown." },
    highlights: { type: "STRING", description: "What makes them different (awards, years running, specialities). Empty if not stated." },
    audience: { type: "STRING", description: "Who they serve, if stated." },
    address: STR,
    directions: { type: "STRING", description: "Parking, landmarks, how to get there — only if stated." },
    serviceArea: { type: "STRING", description: "Delivery or service coverage area, if stated." },
    phone: STR,
    email: STR,
    hours: {
      type: "ARRAY",
      description: "Weekly opening hours. One entry per open period per day. Omit closed days.",
      items: {
        type: "OBJECT",
        properties: {
          dayOfWeek: { type: "INTEGER", description: "0=Sunday, 1=Monday … 6=Saturday" },
          startTime: { type: "STRING", description: "24h HH:MM" },
          endTime: { type: "STRING", description: "24h HH:MM" },
        },
        required: ["dayOfWeek", "startTime", "endTime"],
      },
    },
    hoursNotes: { type: "STRING", description: "Holiday closures, last orders, exceptions — only if stated." },
    products: {
      type: "ARRAY",
      description: "Products/services/menu items/packages.",
      items: {
        type: "OBJECT",
        properties: {
          name: STR,
          price: { type: "STRING", description: "Exactly as written, with currency (e.g. 'RM 45', 'from RM120'). Empty if not stated — never estimate." },
          description: STR,
        },
        required: ["name"],
      },
    },
    productNotes: { type: "STRING", description: "General pricing notes (e.g. 'prices exclude SST', 'min order RM30')." },
    ...Object.fromEntries(POLICY_FIELDS.map((f) => [`policy_${f.key}`, { type: "STRING", description: `${f.label} policy, only if stated.` }])),
    faqs: {
      type: "ARRAY",
      description: "Questions customers ask, with the answer the sources give. Include FAQ sections verbatim-ish; don't repeat what's already in the fields above.",
      items: { type: "OBJECT", properties: { question: STR, answer: STR }, required: ["question", "answer"] },
    },
  },
  required: ["businessDescription", "products", "faqs", "hours"],
};

interface Extracted {
  businessDescription?: string;
  highlights?: string;
  audience?: string;
  address?: string;
  directions?: string;
  serviceArea?: string;
  phone?: string;
  email?: string;
  hours?: { dayOfWeek?: number; startTime?: string; endTime?: string }[];
  hoursNotes?: string;
  products?: { name?: string; price?: string; description?: string }[];
  productNotes?: string;
  faqs?: { question?: string; answer?: string }[];
  [policy: `policy_${string}`]: string | undefined;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanHours(raw: Extracted["hours"]): BusinessHoursInterval[] {
  const out: BusinessHoursInterval[] = [];
  for (const h of raw ?? []) {
    const day = Number(h.dayOfWeek);
    // "24:00" closing → end of day; anything past midnight isn't representable in one day's interval.
    const end = h.endTime === "24:00" ? "23:59" : String(h.endTime ?? "");
    const start = String(h.startTime ?? "");
    if (!Number.isInteger(day) || day < 0 || day > 6 || !HHMM.test(start) || !HHMM.test(end) || end <= start) continue;
    if (out.some((o) => o.dayOfWeek === day && start < o.endTime && end > o.startTime)) continue;
    out.push({ dayOfWeek: day, startTime: start, endTime: end });
  }
  return out.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
}

function toDraft(x: Extracted, website: string, socials: string[]): ImportDraft {
  const location = normalizeSection("location", {
    address: x.address,
    directions: x.directions,
    serviceArea: x.serviceArea,
    phone: x.phone,
    email: x.email,
    // The owner's own links are facts, not extraction — always carried over.
    website,
    socials: socials.join(", "),
    hoursNotes: x.hoursNotes,
  });
  const products = normalizeSection("products", { items: x.products ?? [], notes: x.productNotes });
  return {
    businessDescription: String(x.businessDescription ?? "").trim().slice(0, 3000),
    profile: normalizeSection("profile", { highlights: x.highlights, audience: x.audience }),
    location,
    hours: cleanHours(x.hours),
    products: products.items.slice(0, 80),
    policies: normalizeSection("policies", Object.fromEntries(POLICY_FIELDS.map((f) => [f.key, x[`policy_${f.key}`]]))),
    faqs: normalizeSection("faqs", { items: x.faqs ?? [] }).items.slice(0, 25),
  };
}

/**
 * Reads the links and extracts a draft — the whole import minus storage, so
 * it can run (and be tried out) without Redis or a tenant. `draft` is null
 * when nothing at all could be read.
 */
export async function buildDraft(
  businessName: string,
  urls: string[],
  onProgress: (step: string) => Promise<unknown> = async () => undefined,
): Promise<{ sources: ImportSource[]; draft: ImportDraft | null }> {
  const classified = urls.map((u) => ({ url: u, social: socialLabel(new URL(u)) }));
  const website = classified.find((c) => !c.social)?.url ?? "";
  const others = classified.filter((c) => c.url !== website);
  const socials = classified.filter((c) => c.social).map((c) => c.url);

  await onProgress(website ? "Reading your website and links…" : "Reading your links…");
  const sources: ImportSource[] = [];
  const blocks: string[] = [];
  await Promise.all([
    website ? gatherWebsite(website, sources, blocks) : Promise.resolve(),
    ...others.map((c) => gatherLink(c.url, c.social ?? "Link", sources, blocks)),
    gatherSearch(businessName, urls, sources, blocks),
  ]);
  if (blocks.length === 0) return { sources, draft: null };

  await onProgress("Writing up what we found…");
  const prompt = `You're setting up the knowledge base for "${businessName}"'s WhatsApp customer-service assistant, from the sources below (their website, public profiles${sources.some((s) => s.label === "Google Search" && s.ok) ? ", Google Search results" : ""}).

Extract the facts into the fields. Rules:
- ONLY facts the sources state about this business. Never invent, estimate or fill gaps — leave a field empty or a list empty instead. A wrong price or wrong opening hour is worse than a missing one.
- If sources disagree, prefer the business's own website, then its Google listing.
- Keep the source's language (English, Malay, Chinese…) for names and descriptions.
- Prices exactly as written, with the currency.
- Hours: 24h HH:MM; "daily"/"every day" means all 7 days; omit closed days.
- Several outlets/branches: put the main (or first listed) one in address, phone and hours, and list every other outlet with its address, hours and phone in hoursNotes, so none are lost.
- Products: each distinct item, service or package once. Skip navigation, blog posts and unrelated text.
- Ignore cookie banners, menus, footers and other site boilerplate.

${blocks.join("\n\n")}`;

  const extracted = await extractStructured<Extracted>(prompt.slice(0, 120_000), EXTRACT_SCHEMA, "business import");
  return { sources, draft: toDraft(extracted, website, socials) };
}

/** The job itself (worker.ts). Never throws — every outcome lands in the import state for the dashboard to show. */
export async function runImport({ tenantId, urls }: BusinessImportJob): Promise<void> {
  const startedAt = (await getImportState(tenantId))?.startedAt ?? new Date().toISOString();
  const finished = () => ({ urls, startedAt, finishedAt: new Date().toISOString() });

  try {
    const tenant = await getTenantById(tenantId);
    if (!tenant) throw new Error("Business not found");
    const { sources, draft } = await buildDraft(tenant.businessName, urls, (step) => writeState(tenantId, { status: "running", urls, startedAt, step }));
    if (!draft) {
      await writeState(tenantId, {
        status: "failed",
        ...finished(),
        sources,
        error: "We couldn't read anything from those links. Check they're public and spelled right, or fill in the pages by hand.",
      });
      return;
    }
    await writeState(tenantId, { status: "done", ...finished(), sources, draft });
  } catch (err) {
    console.error(`[import] tenant ${tenantId} failed:`, err);
    await writeState(tenantId, {
      status: "failed",
      ...finished(),
      error: "Something went wrong reading those links (the AI service may be busy). Please try again in a minute.",
    });
  }
}

// --- Applying a reviewed draft ------------------------------------------------

export const IMPORT_PARTS = ["profile", "location", "hours", "products", "policies", "faqs"] as const;
export type ImportPart = (typeof IMPORT_PARTS)[number];

const blank = (s: string | undefined) => !s?.trim();
const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Fill-only merge: empty fields take the draft's value; lists gain the draft's new entries; nothing the owner wrote is replaced. */
function fillEmpty<T extends object>(current: T | undefined, draft: T): { merged: T; filled: number } {
  const merged = { ...draft, ...(current ?? {}) } as T;
  let filled = 0;
  for (const [k, v] of Object.entries(draft) as [keyof T, unknown][]) {
    if (typeof v === "string" && v.trim() && blank(current?.[k] as string | undefined)) {
      merged[k] = v as T[keyof T];
      filled++;
    }
  }
  return { merged, filled };
}

export interface ApplySummary {
  [part: string]: number;
}

export async function applyImport(tenantId: string, parts: ImportPart[]): Promise<ApplySummary> {
  const state = await getImportState(tenantId);
  if (state?.status !== "done" || !state.draft) throw new ImportRejectedError(409, "There's no finished import to apply");
  const draft = state.draft;

  const [tenant, rows, hours] = await Promise.all([
    getTenantById(tenantId),
    withTenant(tenantId, (client) => listBusinessInfo(client)),
    withTenant(tenantId, (client) => listBusinessHours(client)),
  ]);
  if (!tenant) throw new Error("Business not found");
  const current = new Map(rows.map((r) => [r.section, r.data]));
  const summary: ApplySummary = {};

  if (parts.includes("profile")) {
    let n = 0;
    if (blank(tenant.businessDescription ?? "") && draft.businessDescription) {
      await updateTenantProfile(tenantId, tenant.businessName, draft.businessDescription);
      n++;
    }
    const { merged, filled } = fillEmpty(current.get("profile") as ProfileData | undefined, draft.profile);
    if (filled) await saveBusinessSection(tenantId, "profile", merged);
    summary.profile = n + filled;
  }

  if (parts.includes("location")) {
    const { merged, filled } = fillEmpty(current.get("location") as LocationData | undefined, draft.location);
    if (filled) await saveBusinessSection(tenantId, "location", merged);
    summary.location = filled;
  }

  // A schedule is one thing — only set it if they haven't entered one at all.
  if (parts.includes("hours")) {
    if (hours.length === 0 && draft.hours.length) {
      await withTenant(tenantId, (client) => replaceBusinessHours(client, tenantId, draft.hours));
      summary.hours = new Set(draft.hours.map((h) => h.dayOfWeek)).size;
    } else summary.hours = 0;
  }

  if (parts.includes("products")) {
    const existing = (current.get("products") as { items: ProductItem[]; notes: string } | undefined) ?? { items: [], notes: "" };
    const have = new Set(existing.items.map((i) => key(i.name)));
    const added = draft.products.filter((p) => !have.has(key(p.name)));
    if (added.length) await saveBusinessSection(tenantId, "products", { ...existing, items: [...existing.items, ...added] });
    summary.products = added.length;
  }

  if (parts.includes("policies")) {
    const { merged, filled } = fillEmpty(current.get("policies") as PoliciesData | undefined, draft.policies);
    if (filled) await saveBusinessSection(tenantId, "policies", merged);
    summary.policies = filled;
  }

  if (parts.includes("faqs")) {
    const existing = (current.get("faqs") as { items: FaqItem[] } | undefined) ?? { items: [] };
    const have = new Set(existing.items.map((i) => key(i.question)));
    const added = draft.faqs.filter((f) => !have.has(key(f.question)));
    if (added.length) await saveBusinessSection(tenantId, "faqs", { items: [...existing.items, ...added] });
    summary.faqs = added.length;
  }

  await dismissImport(tenantId);
  return summary;
}
