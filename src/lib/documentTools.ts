import type { DocumentSummary } from "../db/documents.js";
import type { ToolCall, ToolDeclaration } from "./gemini.js";
import { sendDocumentMessage } from "./whatsapp.js";
import { config } from "./config.js";

const SEND_DOCUMENT = "send_document";

// So worker.ts can route a tool call to the right executor (this module vs.
// bookingTools.ts) without either module needing to know about the other.
export const DOCUMENT_TOOL_NAMES: readonly string[] = [SEND_DOCUMENT];

/** [] for a tenant with no documents uploaded — worker.ts merges this into runReplyTurn's actionTools alongside booking tools. */
export function buildDocumentTools(documents: DocumentSummary[]): ToolDeclaration[] {
  if (documents.length === 0) return [];
  const names = documents.map((d) => d.name);

  return [
    {
      name: SEND_DOCUMENT,
      description:
        "Sends a file (menu, catalog, price list, etc.) to the customer on WhatsApp. Call this when the customer asks for one of the available documents by name, or clearly implies wanting one (e.g. \"send me your menu\").",
      parameters: {
        type: "OBJECT",
        properties: {
          document_name: { type: "STRING", description: "Exact document name the customer wants.", enum: names },
        },
        required: ["document_name"],
      },
    },
  ];
}

function findDocument(documents: DocumentSummary[], name: string): DocumentSummary | undefined {
  return documents.find((d) => d.name.toLowerCase() === name.toLowerCase());
}

export interface DocumentToolContext {
  tenantId: string;
  waPhoneNumberId: string;
  contactWaNumber: string;
  documents: DocumentSummary[];
}

export async function executeDocumentTool(ctx: DocumentToolContext, call: ToolCall): Promise<unknown> {
  if (call.name !== SEND_DOCUMENT) return { error: `Unknown tool "${call.name}"` };

  const documentName = call.args.document_name as string | undefined;
  const doc = documentName ? findDocument(ctx.documents, documentName) : undefined;
  if (!doc) {
    return { success: false, error: `Unknown document "${documentName}". Available: ${ctx.documents.map((d) => d.name).join(", ")}` };
  }

  // routes/files.ts serves this — public and unauthenticated (Meta's
  // servers fetch it directly, not a logged-in dashboard user), scoped by
  // RLS via the tenantId embedded right in the path.
  const link = `${config.backendPublicUrl}/files/${ctx.tenantId}/${doc.id}`;
  await sendDocumentMessage(ctx.waPhoneNumberId, ctx.contactWaNumber, link, doc.filename, doc.name);
  return { success: true, sent: doc.name };
}
