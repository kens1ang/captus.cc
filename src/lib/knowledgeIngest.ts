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

// Bounded concurrency for embedding calls during ingestion — a real client's
// FAQ doc can be dozens of chunks, and embedding them one at a time (a full
// network round-trip apiece) turns "add my FAQ" into a slow serial wait.
// Bounded (rather than one big Promise.all) so a large doc doesn't fire
// everything at once and risk tripping Gemini's rate limits.
const INGEST_CONCURRENCY = 5;

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Chunk → embed → store, scoped to one tenant. Used by both `npm run ingest` and the dashboard's FAQ-edit API. */
export async function ingestKnowledgeText(tenantId: string, text: string, source: string): Promise<number> {
  const chunks = chunkText(text);
  await mapWithConcurrency(chunks, INGEST_CONCURRENCY, async (chunk) => {
    const embedding = await embedText(chunk);
    await withTenant(tenantId, (client) => insertKnowledgeChunk(client, tenantId, chunk, embedding, source));
  });
  return chunks.length;
}
