import { backendFetch } from "@/lib/backend";
import { formatDateTime } from "@/lib/formatDate";
import { uploadDocument, deleteDocumentAction } from "./actions";

interface DocumentSummary {
  id: string;
  name: string;
  description: string | null;
  filename: string;
  mimeType: string;
  createdAt: string;
}

export default async function DocumentsPage() {
  const [documents, settings] = await Promise.all([
    backendFetch<DocumentSummary[]>("/api/documents"),
    backendFetch<{ timezone: string }>("/api/settings"),
  ]);

  return (
    <div className="p-6 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Documents</h1>
      <p className="text-sm text-gray-500 -mt-4">
        Files the bot can send customers on WhatsApp when they ask — a menu, catalog, price list, anything in PDF, image, or
        spreadsheet form.
      </p>

      <form action={uploadDocument} className="flex flex-col gap-2 border border-gray-200 rounded p-4">
        <h2 className="text-sm font-medium">Add a document</h2>
        <input name="name" placeholder='Short name the bot matches on, e.g. "Menu"' className="border border-gray-300 rounded px-3 py-2 text-sm" required />
        <input
          name="description"
          placeholder="Optional description, to help the bot know when it's relevant"
          className="border border-gray-300 rounded px-3 py-2 text-sm"
        />
        <input name="file" type="file" className="text-sm" required />
        <button type="submit" className="self-start px-4 py-2 rounded bg-gray-900 text-white text-sm">
          Upload
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {documents.map((d) => (
          <li key={d.id} className="flex items-center justify-between border border-gray-200 rounded p-3 text-sm">
            <div>
              <p className="font-medium">{d.name}</p>
              {d.description && <p className="text-gray-500">{d.description}</p>}
              <p className="text-xs text-gray-400 font-mono mt-1">
                {d.filename} · {formatDateTime(d.createdAt, settings.timezone)}
              </p>
            </div>
            <form action={deleteDocumentAction.bind(null, d.id)}>
              <button type="submit" className="text-xs text-red-600 hover:underline">
                Delete
              </button>
            </form>
          </li>
        ))}
        {documents.length === 0 && <p className="text-sm text-gray-400">No documents yet.</p>}
      </ul>
    </div>
  );
}
