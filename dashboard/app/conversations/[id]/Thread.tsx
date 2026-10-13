"use client";

import { useActionState, useEffect, useLayoutEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { CircleAlert, Loader2, SendHorizontal } from "lucide-react";
import { cx } from "@/components/ui";
import type { ActionState } from "@/lib/actionState";

/** Keeps the thread pinned to the newest message — on open, and as new ones arrive via auto-refresh. */
export function ScrollToBottom({ count }: { count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ref.current?.scrollIntoView({ block: "end" });
  }, [count]);
  return <div ref={ref} />;
}

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg transition-colors hover:bg-brand-strong disabled:opacity-50"
      aria-label="Send"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
    </button>
  );
}

export function Composer({
  action,
  assistantActive,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  assistantActive: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state?.ok) inputRef.current?.focus();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="border-t border-line bg-panel px-4 py-3">
      {state && !state.ok && (
        <p className="mb-2 flex items-center gap-1.5 text-sm text-danger">
          <CircleAlert className="size-4" /> Couldn&apos;t send: {state.message}
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          name="text"
          rows={1}
          required
          placeholder={assistantActive ? "Reply yourself — this pauses the assistant for this chat" : "Type a reply…"}
          className="control max-h-40 min-h-10 resize-none rounded-2xl py-2.5 [field-sizing:content]"
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter adds a line — like WhatsApp Web.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
        />
        <SendButton />
      </div>
      <p className={cx("mt-1.5 px-1 text-[11px] text-faint")}>Enter to send · Shift + Enter for a new line</p>
    </form>
  );
}
