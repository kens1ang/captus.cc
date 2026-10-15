"use client";

import { useActionState, type ComponentProps, type ReactNode } from "react";
import { Clock3, Trash2, Users } from "lucide-react";
import type { ActionState } from "@/lib/actionState";
import type { Service } from "@/lib/data";
import { ActionStatus, ConfirmButton, SubmitButton } from "./forms";

/** Compact inline number field: icon, value, unit. */
function InlineNumber({
  label,
  icon,
  suffix,
  ...props
}: {
  label: string;
  icon: ReactNode;
  suffix: string;
} & ComponentProps<"input">) {
  return (
    <label className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-panel px-2 text-xs text-muted shadow-xs transition-colors hover:border-line-strong focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
      <span className="text-faint">{icon}</span>
      <input type="number" required aria-label={label} className="w-10 bg-transparent text-right text-sm text-fg outline-none" {...props} />
      <span className="whitespace-nowrap">{suffix}</span>
    </label>
  );
}

/** One bookable service: name, editable duration + bookings-at-a-time, save and remove. */
export function ServiceRow({
  service,
  update,
  remove,
}: {
  service: Service;
  update: (state: ActionState, formData: FormData) => Promise<ActionState>;
  remove: () => Promise<unknown>;
}) {
  const [state, formAction] = useActionState(update, null);
  return (
    // ConfirmButton is its own <form>, so it sits beside the edit form (not
    // nested in it); `contents` lets both share the row's flex layout.
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
      <p className="min-w-0 flex-1 basis-full truncate text-sm font-medium sm:basis-0">{service.name}</p>
      <form action={formAction} onReset={(e) => e.preventDefault()} className="contents">
        <InlineNumber
          name="durationMinutes"
          label={`Duration for ${service.name}, in minutes`}
          icon={<Clock3 className="size-3.5" />}
          suffix="min"
          min={5}
          step={5}
          defaultValue={service.durationMinutes}
        />
        <InlineNumber
          name="capacity"
          label={`Bookings at a time for ${service.name}`}
          icon={<Users className="size-3.5" />}
          suffix="at a time"
          min={1}
          max={100}
          step={1}
          defaultValue={service.capacity}
        />
        <SubmitButton variant="secondary" size="sm" pendingText="Saving…">
          Save
        </SubmitButton>
      </form>
      <ConfirmButton
        action={remove}
        confirmText={`Remove "${service.name}"? Customers won't be able to book it any more.`}
        title="Remove service"
      >
        <Trash2 className="size-3.5" />
      </ConfirmButton>
      {state && (
        <div className="flex basis-full justify-end">
          <ActionStatus state={state} />
        </div>
      )}
    </div>
  );
}
