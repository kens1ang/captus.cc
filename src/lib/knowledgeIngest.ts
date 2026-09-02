import { embedText } from "./gemini.js";
import { insertKnowledgeChunk } from "../db/knowledge.js";
import { withTenant } from "../db/tenantContext.js";

export function chunkText(text: string, maxLen = 800): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && current.length + p.length + 2 > maxLen) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Chunk → embed → store, scoped to one tenant. Used by both `npm run ingest` and the dashboard's FAQ-edit API. */
export async function ingestKnowledgeText(tenantId: string, text: string, source: string): Promise<number> {
  const chunks = chunkText(text);
  for (const chunk of chunks) {
    const embedding = await embedText(chunk);
    await withTenant(tenantId, (client) => insertKnowledgeChunk(client, tenantId, chunk, embedding, source));
  }
  return chunks.length;
}
