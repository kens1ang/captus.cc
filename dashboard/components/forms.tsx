"use client";

import { createContext, use, useActionState, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import type { ActionState } from "@/lib/actionState";
import { buttonClass, cx } from "./ui";

const FormStateContext = createContext<ActionState>(null);

export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & {
  pendingText?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || props.disabled} className={buttonClass(variant, size, className)} {...props}>
      {pending && <Loader2 className="size-3.5 animate-spin" />}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

/** Inline "Saved ✓" / error line that fades out after a success. */
export function ActionStatus({ state }: { state: ActionState }) {
  // Track which result was dismissed rather than which is visible, so a new
  // result shows immediately without a state update during the effect.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!state?.ok) return;
    const t = setTimeout(() => setDismissedAt(state.at), 3500);
    return () => clearTimeout(t);
  }, [state]);

  if (!state || dismissedAt === state.at) return null;
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-sm", state.ok ? "text-brand-strong" : "text-danger")} role="status">
      {state.ok ? <Check className="size-4" /> : <CircleAlert className="size-4" />}
      {state.message}
    </span>
  );
}

/**
 * A <form> bound to a Server Action that returns ActionState. `children` may
 * be a render function to read the latest state (e.g. to reset local state).
 * The footer — status + submit — is rendered by the caller via <FormFooter>
 * inside, which picks up pending state from the form automatically.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode | ((state: ActionState) => ReactNode);
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form
      action={formAction}
      className={className}
      // React resets uncontrolled forms after an action by default; keep the
      // owner's typed values on screen unless the caller wants a clean slate
      // (e.g. "add another"), so a save never looks like it wiped the form.
      onReset={resetOnSuccess ? undefined : (e) => e.preventDefault()}
    >
      <FormStateContext value={state}>{typeof children === "function" ? children(state) : children}</FormStateContext>
    </form>
  );
}

/** Status + submit button for the nearest <ActionForm>. */
export function FormFooter({
  submitLabel = "Save changes",
  pendingText = "Saving…",
  children,
  className,
}: {
  submitLabel?: string;
  pendingText?: string;
  children?: ReactNode;
  className?: string;
}) {
  const state = use(FormStateContext);
  return (
    <div className={cx("flex items-center justify-end gap-3 rounded-b-lg border-t border-line bg-subtle/60 px-5 py-3", className)}>
      <ActionStatus state={state} />
      {children}
      <SubmitButton pendingText={pendingText}>{submitLabel}</SubmitButton>
    </div>
  );
}

/** A small form + button that asks for confirmation before running a destructive action. */
export function ConfirmButton({
  action,
  confirmText,
  children,
  variant = "ghost",
  className,
  title,
}: {
  action: () => Promise<unknown>;
  confirmText: string;
  children: ReactNode;
  variant?: "ghost" | "danger" | "secondary";
  className?: string;
  title?: string;
}) {
  return (
    <form
      action={async () => {
        await action();
      }}
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
    >
      <SubmitButton variant={variant} size="sm" className={className} title={title} aria-label={title}>
        {children}
      </SubmitButton>
    </form>
  );
}
