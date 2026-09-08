import { backendFetch } from "@/lib/backend";
import { formatDateTime } from "@/lib/formatDate";
import { sendReply, resumeBot } from "./actions";
import { AutoRefresh } from "@/components/AutoRefresh";

interface ConversationDetail {
  id: string;
  waNumber: string;
  status: "bot" | "needs_human" | "human_active";
  summary: string | null;
}

interface FullMessage {
  id: string;
  direction: "in" | "out";
  content: string;
  createdAt: string;
}

export default async function ConversationPage(props: PageProps<"/conversations/[id]">) {
  const { id } = await props.params;

  const [conversation, messages, settings] = await Promise.all([
    backendFetch<ConversationDetail>(`/api/conversations/${id}`),
    backendFetch<FullMessage[]>(`/api/conversations/${id}/messages`),
    backendFetch<{ timezone: string }>("/api/settings"),
  ]);

  return (
    <div className="p-6 max-w-2xl mx-auto flex flex-col gap-4">
      <AutoRefresh />
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold font-mono">{conversation.waNumber}</h1>
        {conversation.status !== "bot" ? (
          <form action={resumeBot.bind(null, id)}>
            <button type="submit" className="text-sm px-3 py-1 rounded bg-gray-800 text-white">
              Resume bot
            </button>
          </form>
        ) : (
          <span className="text-xs text-gray-500">Bot is auto-replying</span>
        )}
      </div>

      {conversation.summary && (
        <div className="border border-gray-200 bg-gray-50 rounded p-3">
          <p className="text-xs font-medium text-gray-600 mb-1">What the bot remembers about this customer</p>
          <p className="text-xs text-gray-500 whitespace-pre-wrap">{conversation.summary}</p>
        </div>
      )}

      <div className="flex flex-col gap-2 border border-gray-200 rounded p-4 max-h-[60vh] overflow-y-auto">
        {messages.map((m) => (
          <div key={m.id} className={`max-w-[80%] rounded px-3 py-2 text-sm ${m.direction === "in" ? "bg-gray-100 self-start" : "bg-blue-100 self-end"}`}>
            <p>{m.content}</p>
            <p className="text-[10px] text-gray-400 mt-1">{formatDateTime(m.createdAt, settings.timezone)}</p>
          </div>
        ))}
        {messages.length === 0 && <p className="text-gray-500 text-sm">No messages yet.</p>}
      </div>

      <form action={sendReply.bind(null, id)} className="flex gap-2">
        <input
          name="text"
          placeholder="Reply as a human — this pauses the bot for this conversation"
          className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
          required
        />
        <button type="submit" className="px-4 py-2 rounded bg-gray-900 text-white text-sm">
          Send
        </button>
      </form>
    </div>
  );
}
