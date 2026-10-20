"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CalendarCheck, FileText, Loader2, MessageCircle, RotateCcw, Search, SendHorizontal, TriangleAlert, X } from "lucide-react";
import { resetTestChat, sendTestMessage, type TestChatAction, type TestChatTurn } from "@/app/knowledge/testChatActions";
import { cx } from "@/components/ui";

interface Entry {
  role: "user" | "model" | "error";
  text: string;
  actions?: TestChatAction[];
  escalation?: { kind: "handover" | "follow_up"; reason: string | null };
}

const STORAGE_KEY = "captus.testChat";
const SUGGESTIONS = ["What are your opening hours?", "How much does it cost?", "Can I book an appointment tomorrow at 3pm?", "Where are you located?"];

function loadEntries(): Entry[] {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]") as Entry[];
  } catch {
    return [];
  }
}

function saveEntries(entries: Entry[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // private mode / storage blocked — the chat still works, it just won't survive a reload
  }
}

function ActionIcon({ kind }: { kind: TestChatAction["kind"] }) {
  const Icon = kind === "document" ? FileText : kind === "availability" || kind === "list" ? Search : CalendarCheck;
  return <Icon className="mt-px size-3.5 shrink-0" />;
}

/** Chat with your own assistant, as a customer would on WhatsApp. Same knowledge and tools; nothing is sent or booked for real. */
function TestChatBody({ onClose }: { onClose?: () => void }) {
  // Browser-only component (see TestChatPanel.tsx), so storage can be read up front.
  const [entries, setEntries] = useState<Entry[]>(loadEntries);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Block body on purpose: newer browsers return a Promise from
  // scrollIntoView, and an effect that returns a non-function crashes the
  // page when React tries to run it as the cleanup.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [entries, pending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    const next: Entry[] = [...entries, { role: "user", text: trimmed }];
    setEntries(next);
    saveEntries(next);
    setInput("");
    setPending(true);

    const transcript: TestChatTurn[] = next.filter((e) => e.role !== "error").map((e) => ({ role: e.role as TestChatTurn["role"], text: e.text }));
    const res = await sendTestMessage(transcript);
    const after: Entry[] = res.ok
      ? [
          ...next,
          {
            role: "model",
            text: res.reply,
            actions: res.actions,
            escalation: res.escalate && res.escalateKind ? { kind: res.escalateKind, reason: res.escalateReason } : undefined,
          },
        ]
      : [...next, { role: "error", text: res.error }];
    setEntries(after);
    saveEntries(after);
    setPending(false);
  }

  async function reset() {
    setEntries([]);
    saveEntries([]);
    await resetTestChat().catch(() => undefined);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  }

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Test your assistant</p>
          <p className="text-xs text-muted">Chat like a customer would. Nothing is sent or booked for real.</p>
        </div>
        <button type="button" onClick={reset} disabled={pending || entries.length === 0} title="Start over" className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg disabled:opacity-40">
          <RotateCcw className="size-4" />
        </button>
        {onClose && (
          <button type="button" onClick={onClose} title="Close" className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg">
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas px-3 py-4">
        {entries.length === 0 && !pending ? (
          <div className="flex flex-col gap-2 px-1 pt-6">
            <p className="text-center text-sm text-muted">Try a question your customers often ask:</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className="rounded-xl border border-line bg-panel px-3 py-2 text-left text-sm hover:border-line-strong">
                {s}
              </button>
            ))}
            <p className="mt-3 text-center text-xs text-faint">Answers come from your Knowledge pages. Save a change, then ask again to see the difference.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {entries.map((e, i) =>
              e.role === "error" ? (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" />
                  <span>{e.text}</span>
                </div>
              ) : (
                <div key={i} className={cx("flex flex-col gap-1", e.role === "user" ? "items-end" : "items-start")}>
                  {e.actions?.map((a, j) => (
                    <div key={j} className="flex max-w-[90%] items-start gap-1.5 rounded-md bg-info-soft px-2.5 py-1 text-[11px] text-info">
                      <ActionIcon kind={a.kind} />
                      {a.link ? (
                        <a href={a.link} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                          {a.text}
                        </a>
                      ) : (
                        <span>{a.text}</span>
                      )}
                    </div>
                  ))}
                  <div
                    className={cx(
                      "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-xs",
                      e.role === "user" ? "rounded-br-md bg-bubble-out" : "rounded-bl-md border border-line bg-panel",
                    )}
                  >
                    <p className="break-words whitespace-pre-wrap">{e.text}</p>
                  </div>
                  {e.escalation && (
                    <div className="flex max-w-[90%] items-start gap-1.5 rounded-md bg-warn-soft px-2.5 py-1 text-[11px] text-warn">
                      <TriangleAlert className="mt-px size-3.5 shrink-0" />
                      <span>
                        {e.escalation.kind === "handover"
                          ? "On WhatsApp, this chat would now be handed to you and the assistant would stop replying"
                          : "On WhatsApp, this chat would be flagged for you to follow up"}
                        {e.escalation.reason ? ` (${e.escalation.reason})` : ""}.
                      </span>
                    </div>
                  )}
                </div>
              ),
            )}
            {pending && (
              <div className="flex items-center gap-2 px-1 text-xs text-muted">
                <Loader2 className="size-3.5 animate-spin" /> Assistant is typing…
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-line p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={2000}
          placeholder="Type a message"
          className="control max-h-32 min-h-9 flex-1 resize-none"
        />
        <button type="submit" disabled={pending || !input.trim()} title="Send" className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand text-brand-fg disabled:opacity-40">
          <SendHorizontal className="size-4" />
        </button>
      </form>
    </div>
  );
}

/** Right-hand column on wide screens; a floating button + slide-over panel on smaller ones. */
export function TestChatPanel() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-[360px] shrink-0 border-l border-line xl:block">
        <TestChatBody />
      </aside>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-30 flex items-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-medium text-brand-fg shadow-lg xl:hidden"
      >
        <MessageCircle className="size-4" /> Test assistant
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30 xl:hidden" onClick={() => setOpen(false)}>
          <div className="h-full w-full max-w-[400px] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <TestChatBody onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
