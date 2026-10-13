import Link from "next/link";
import { ArrowLeft, Bot, Brain, UserRound } from "lucide-react";
import { backendFetch } from "@/lib/backend";
import { getSettings, type ConversationStatus } from "@/lib/data";
import { formatDate, formatPhone, formatTime } from "@/lib/formatDate";
import { ContactAvatar, StatusBadge } from "@/components/ConversationStatus";
import { SubmitButton } from "@/components/forms";
import { cx } from "@/components/ui";
import { sendReply, resumeBot } from "./actions";
import { Composer, ScrollToBottom } from "./Thread";

interface ConversationDetail {
  id: string;
  waNumber: string;
  status: ConversationStatus;
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
    getSettings(),
  ]);
  const tz = settings.timezone;

  // Group consecutive messages under a date divider, WhatsApp-style.
  const groups: { date: string; messages: FullMessage[] }[] = [];
  for (const m of messages) {
    const date = formatDate(m.createdAt, tz);
    const last = groups[groups.length - 1];
    if (last?.date === date) last.messages.push(m);
    else groups.push({ date, messages: [m] });
  }

  const assistantActive = conversation.status === "bot";

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-panel px-4 py-3">
        <Link href="/conversations" className="-ml-1 rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg md:hidden" aria-label="Back to inbox">
          <ArrowLeft className="size-4" />
        </Link>
        <ContactAvatar waNumber={conversation.waNumber} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{formatPhone(conversation.waNumber)}</p>
          <div className="mt-0.5">
            <StatusBadge status={conversation.status} />
          </div>
        </div>
        {!assistantActive && (
          <form action={resumeBot.bind(null, id)}>
            <SubmitButton variant="secondary" size="sm" pendingText="Handing back…">
              <Bot className="size-3.5" /> Hand back to assistant
            </SubmitButton>
          </form>
        )}
      </header>

      {conversation.status === "needs_human" && (
        <div className="border-b border-warn/25 bg-warn-soft px-4 py-2.5 text-sm text-warn">
          The assistant flagged this chat for you. Reply below — it stays paused here until you hand it back.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex-1 overflow-y-auto bg-canvas px-4 py-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-1.5">
            {groups.map((g) => (
              <div key={g.date} className="flex flex-col gap-1.5">
                <div className="my-3 flex justify-center">
                  <span className="rounded-full border border-line bg-panel px-3 py-0.5 text-[11px] font-medium text-muted">{g.date}</span>
                </div>
                {g.messages.map((m) => (
                  <div key={m.id} className={cx("flex", m.direction === "in" ? "justify-start" : "justify-end")}>
                    <div
                      className={cx(
                        "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-xs",
                        m.direction === "in" ? "rounded-bl-md border border-line bg-panel" : "rounded-br-md bg-bubble-out",
                      )}
                    >
                      <p className="break-words whitespace-pre-wrap">{m.content}</p>
                      <p className="mt-1 text-right text-[10px] text-faint">{formatTime(m.createdAt, tz)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {messages.length === 0 && <p className="py-10 text-center text-sm text-muted">No messages yet.</p>}
            <ScrollToBottom count={messages.length} />
          </div>
        </div>

        <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-line bg-panel p-5 xl:block">
          <p className="mb-3 text-xs font-medium tracking-wider text-faint uppercase">Customer</p>
          <div className="flex items-center gap-2 text-sm">
            <UserRound className="size-4 text-faint" />
            <span className="font-mono text-xs">{formatPhone(conversation.waNumber)}</span>
          </div>
          <p className="mt-6 mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wider text-faint uppercase">
            <Brain className="size-3.5" /> What the assistant remembers
          </p>
          {conversation.summary ? (
            <p className="text-sm whitespace-pre-wrap text-muted">{conversation.summary}</p>
          ) : (
            <p className="text-sm text-faint">Nothing yet — a summary builds up as the conversation grows.</p>
          )}
        </aside>
      </div>

      <Composer action={sendReply.bind(null, id)} assistantActive={assistantActive} />
    </div>
  );
}
