import Link from "next/link";
import { backendFetch, BackendError } from "@/lib/backend";
import { formatDateTime } from "@/lib/formatDate";
import { AutoRefresh } from "@/components/AutoRefresh";

interface ConversationSummary {
  id: string;
  waNumber: string;
  status: "bot" | "needs_human" | "human_active";
  lastMessageAt: string;
}

const STATUS_LABEL: Record<ConversationSummary["status"], string> = {
  bot: "Bot handling",
  needs_human: "Needs human",
  human_active: "Human active",
};

const STATUS_CLASS: Record<ConversationSummary["status"], string> = {
  bot: "bg-gray-100 text-gray-700",
  needs_human: "bg-amber-100 text-amber-800",
  human_active: "bg-blue-100 text-blue-800",
};

export default async function ConversationsPage() {
  let conversations: ConversationSummary[] = [];
  let timezone = "Asia/Singapore";
  let notLinked = false;

  try {
    [conversations, { timezone }] = await Promise.all([
      backendFetch<ConversationSummary[]>("/api/conversations"),
      backendFetch<{ timezone: string }>("/api/settings"),
    ]);
  } catch (err) {
    if (err instanceof BackendError && err.status === 403) {
      notLinked = true;
    } else {
      throw err;
    }
  }

  if (notLinked) {
    return (
      <div className="p-8">
        <p className="text-gray-600">
          Your account isn&apos;t linked to a business yet. Ask whoever runs the backend to run{" "}
          <code className="bg-gray-100 px-1 rounded">npm run link-user</code> for your Clerk user id.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <AutoRefresh />
      <h1 className="text-lg font-semibold mb-4">Conversations</h1>
      {conversations.length === 0 && <p className="text-gray-500">No conversations yet.</p>}
      <ul className="divide-y divide-gray-200 border border-gray-200 rounded">
        {conversations.map((c) => (
          <li key={c.id}>
            <Link href={`/conversations/${c.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
              <span className="font-mono text-sm">{c.waNumber}</span>
              <span className={`text-xs px-2 py-0.5 rounded ${STATUS_CLASS[c.status]}`}>{STATUS_LABEL[c.status]}</span>
              <span className="text-xs text-gray-400">{formatDateTime(c.lastMessageAt, timezone)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
