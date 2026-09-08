import { backendFetch } from "@/lib/backend";
import { formatDateTime } from "@/lib/formatDate";
import { addKnowledge, deleteKnowledge } from "./actions";

interface KnowledgeChunk {
  id: string;
  content: string;
  source: string | null;
  createdAt: string;
}

export default async function KnowledgePage() {
  const [chunks, settings] = await Promise.all([
    backendFetch<KnowledgeChunk[]>("/api/knowledge"),
    backendFetch<{ timezone: string }>("/api/settings"),
  ]);

  return (
    <div className="p-6 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Knowledge base</h1>

      <form action={addKnowledge} className="flex flex-col gap-2">
        <textarea
          name="text"
          placeholder="Paste FAQ text — pricing, hours, policies, anything customers ask. It'll be split into chunks automatically."
          className="border border-gray-300 rounded px-3 py-2 text-sm min-h-[100px]"
          required
        />
        <button type="submit" className="self-start px-4 py-2 rounded bg-gray-900 text-white text-sm">
          Add to knowledge base
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {chunks.map((c) => (
          <li key={c.id} className="border border-gray-200 rounded p-3 flex justify-between gap-4">
            <div>
              <p className="text-sm whitespace-pre-wrap">{c.content}</p>
              <p className="text-xs text-gray-400 mt-1">
                {c.source ?? "unknown source"} · {formatDateTime(c.createdAt, settings.timezone)}
              </p>
            </div>
            <form action={deleteKnowledge.bind(null, c.id)}>
              <button type="submit" className="text-xs text-red-600 hover:underline">
                Delete
              </button>
            </form>
          </li>
        ))}
        {chunks.length === 0 && <p className="text-gray-500 text-sm">No knowledge base entries yet.</p>}
      </ul>
    </div>
  );
}
