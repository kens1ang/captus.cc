import { withTenant } from "../db/tenantContext.js";
import { upsertBusinessInfo } from "../db/businessInfo.js";
import { replaceKnowledgeSource } from "./knowledgeIngest.js";
import { INDEXED_SECTIONS, knowledgeSourceFor, normalizeSection, renderIndexedChunks, type SectionDataMap, type SectionKey } from "./businessInfo.js";

/**
 * Saves one Knowledge section, re-indexing it for FAQ search when it's an
 * indexed one — the single write path for both the dashboard's Knowledge
 * pages and the website import (lib/businessImport.ts), so the stored form
 * and the searchable chunks can't drift apart. Returns the normalized data
 * and, for indexed sections, how many chunks are now searchable.
 */
export async function saveBusinessSection<K extends SectionKey>(
  tenantId: string,
  section: K,
  raw: unknown,
): Promise<{ data: SectionDataMap[K]; chunksIndexed?: number }> {
  const data = normalizeSection(section, raw);
  if (INDEXED_SECTIONS.includes(section)) {
    const chunksIndexed = await replaceKnowledgeSource(tenantId, knowledgeSourceFor(section), renderIndexedChunks(section, data), (client) =>
      upsertBusinessInfo(client, tenantId, section, data),
    );
    return { data, chunksIndexed };
  }
  await withTenant(tenantId, (client) => upsertBusinessInfo(client, tenantId, section, data));
  return { data };
}
