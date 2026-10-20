import type { PoolClient } from "pg";
import { withTenant } from "../db/tenantContext.js";
import { searchKnowledge } from "../db/knowledge.js";
import { listServices, type Service } from "../db/services.js";
import { listDocuments, type DocumentSummary } from "../db/documents.js";
import { listBusinessInfo } from "../db/businessInfo.js";
import { listBusinessHours } from "../db/businessHours.js";
import type { Tenant } from "../db/tenants.js";
import { renderAlwaysOnInfo, renderAssistantStyle, type ProfileData, type LocationData, type AssistantData } from "./businessInfo.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { embedText } from "./gemini.js";
import { GeminiError } from "./llmFallback.js";
import { alertOperator } from "./opsAlert.js";

// What a reply is built from, shared by the WhatsApp reply worker and the
// dashboard's test chat — so what an owner sees in the test chat is what
// their customers get, not a look-alike that drifts.

const RAG_TOP_K = 4;

export interface BusinessContext {
  services: Service[];
  documents: DocumentSummary[];
  businessInfo: { alwaysOn: string; assistantStyle: string };
}

/** DB-only (runs inside the caller's withTenant): everything about the business that goes into a reply. */
export async function loadBusinessContext(client: PoolClient): Promise<BusinessContext> {
  // Services this tenant can be booked for, and documents it can send —
  // [] for a tenant with neither, which keeps the reply agent's tool list
  // FAQ-only.
  const services = await listServices(client);
  const documents = await listDocuments(client);
  // Owner-entered business facts + voice (dashboard Knowledge pages) —
  // the always-on part of the prompt, see lib/businessInfo.ts.
  const sections = new Map((await listBusinessInfo(client)).map((r) => [r.section, r.data]));
  const hours = await listBusinessHours(client);
  const businessInfo = {
    alwaysOn: renderAlwaysOnInfo({
      profile: sections.get("profile") as ProfileData | undefined,
      location: sections.get("location") as LocationData | undefined,
      hours,
    }),
    assistantStyle: renderAssistantStyle(sections.get("assistant") as AssistantData | undefined),
  };
  return { services, documents, businessInfo };
}

/**
 * The system prompt for one reply: the business context plus the FAQ
 * chunks most relevant to `queryText`. No DB connection is held during the
 * embedding call. If embedding fails, answers without the FAQ lookup rather
 * than not at all — the always-on info (hours, prices, policies) is still
 * in the prompt, which covers most questions. There's no fallback
 * embedding model to switch to (see config.gemini.embeddingModel).
 */
export async function buildReplySystemPrompt(
  tenant: Tenant,
  context: BusinessContext,
  queryText: string,
  customerMemory: string | null,
  logLabel: string,
): Promise<string> {
  let knowledge: { content: string }[] = [];
  try {
    const queryEmbedding = await embedText(queryText);
    knowledge = await withTenant(tenant.id, (client) => searchKnowledge(client, queryEmbedding, RAG_TOP_K));
  } catch (err) {
    console.warn(`[reply] FAQ lookup failed for ${logLabel}, replying without it:`, err);
    if (err instanceof GeminiError && (err.kind === "auth" || err.kind === "billing" || err.kind === "model_not_found" || err.kind === "quota_exhausted")) {
      await alertOperator(`embed:${err.kind}`, `FAQ search is down (${err.message}). Replies still go out, but without FAQ answers.`);
    }
  }
  return buildSystemPrompt(
    tenant.businessName,
    tenant.businessDescription,
    knowledge.map((k) => k.content),
    tenant.timezone,
    context.services,
    context.documents,
    customerMemory,
    context.businessInfo,
  );
}
