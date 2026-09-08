import type { PoolClient } from "pg";

export interface DocumentSummary {
  id: string;
  name: string;
  description: string | null;
  filename: string;
  mimeType: string;
  createdAt: string;
}

export interface DocumentFile {
  filename: string;
  mimeType: string;
  fileData: Buffer;
}

interface DocumentRow {
  id: string;
  name: string;
  description: string | null;
  filename: string;
  mime_type: string;
  created_at: string;
}

function toSummary(row: DocumentRow): DocumentSummary {
  return { id: row.id, name: row.name, description: row.description, filename: row.filename, mimeType: row.mime_type, createdAt: row.created_at };
}

/** What the bot's send_document tool picks from, and what the dashboard's Documents page lists — never the file bytes themselves. */
export async function listDocuments(client: PoolClient): Promise<DocumentSummary[]> {
  const result = await client.query<DocumentRow>(
    `SELECT id, name, description, filename, mime_type, created_at FROM documents ORDER BY name`,
  );
  return result.rows.map(toSummary);
}

export async function createDocument(
  client: PoolClient,
  tenantId: string,
  input: { name: string; description: string | null; filename: string; mimeType: string; fileData: Buffer },
): Promise<DocumentSummary> {
  const result = await client.query<DocumentRow>(
    `INSERT INTO documents (tenant_id, name, description, filename, mime_type, file_data)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, description, filename, mime_type, created_at`,
    [tenantId, input.name, input.description, input.filename, input.mimeType, input.fileData],
  );
  return toSummary(result.rows[0]);
}

/** Returns whether a row was actually deleted (false if it belonged to another tenant, blocked by RLS). */
export async function deleteDocument(client: PoolClient, id: string): Promise<boolean> {
  const result = await client.query(`DELETE FROM documents WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

/** The actual bytes — only routes/files.ts (serving the public download link) and nothing else should call this. */
export async function getDocumentFile(client: PoolClient, id: string): Promise<DocumentFile | null> {
  const result = await client.query<{ filename: string; mime_type: string; file_data: Buffer }>(
    `SELECT filename, mime_type, file_data FROM documents WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? { filename: row.filename, mimeType: row.mime_type, fileData: row.file_data } : null;
}
