import type { PoolClient } from "pg";

// pgvector wants its literal as a string like "[0.1,0.2,...]"; pg has no
// native vector type so we cast it in SQL with ::vector.
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export interface KnowledgeChunk {
  content: string;
  source: string | null;
}

/**
 * Brute-force cosine-distance nearest neighbors — plenty fast at SME
 * (hundreds–low-thousands) volumes. No explicit tenant_id filter here — RLS
 * (via the client's app.tenant_id, set by withTenant()) scopes this to the
 * current tenant's chunks only.
 */
export async function searchKnowledge(client: PoolClient, embedding: number[], k: number): Promise<KnowledgeChunk[]> {
  const result = await client.query<KnowledgeChunk>(
    `SELECT content, source FROM knowledge_chunks
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [toVectorLiteral(embedding), k],
  );
  return result.rows;
}

export async function insertKnowledgeChunk(
  client: PoolClient,
  tenantId: string,
  content: string,
  embedding: number[],
  source?: string,
): Promise<void> {
  await client.query(
    `INSERT INTO knowledge_chunks (tenant_id, content, embedding, source) VALUES ($1, $2, $3::vector, $4)`,
    [tenantId, content, toVectorLiteral(embedding), source ?? null],
  );
}

export interface KnowledgeChunkRow extends KnowledgeChunk {
  id: string;
  createdAt: string;
}

/** Dashboard's FAQ list — newest first. */
export async function listKnowledgeChunks(client: PoolClient): Promise<KnowledgeChunkRow[]> {
  const result = await client.query<{ id: string; content: string; source: string | null; created_at: string }>(
    `SELECT id, content, source, created_at FROM knowledge_chunks ORDER BY created_at DESC`,
  );
  return result.rows.map((r) => ({ id: r.id, content: r.content, source: r.source, createdAt: r.created_at }));
}

/** Returns whether a row was actually deleted (false if it belonged to another tenant, blocked by RLS). */
export async function deleteKnowledgeChunk(client: PoolClient, id: string): Promise<boolean> {
  const result = await client.query(`DELETE FROM knowledge_chunks WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

/** Removes every chunk from one source — how a re-saved section replaces its old chunks instead of duplicating them. */
export async function deleteKnowledgeBySource(client: PoolClient, source: string): Promise<void> {
  await client.query(`DELETE FROM knowledge_chunks WHERE source = $1`, [source]);
}
