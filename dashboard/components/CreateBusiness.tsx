"use client";

import { UserButton } from "@clerk/nextjs";
import { createBusiness } from "@/app/welcome/actions";
import { ActionForm, ActionStatus, SubmitButton } from "@/components/forms";
import { BrandMark } from "@/components/BrandMark";
import { Field } from "@/components/ui";

/** First screen after signing up: name the business, then straight into setup — no WhatsApp number needed yet. */
export function CreateBusiness() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-line bg-panel p-8 shadow-xs">
        <div className="mb-6 flex items-center justify-between">
          <BrandMark className="size-9" />
          <UserButton />
        </div>
        <h1 className="text-lg font-semibold">Welcome to Captus</h1>
        <p className="mt-1.5 text-sm text-muted">
          Set up your assistant and try it right here in the dashboard. You can connect your WhatsApp number later.
        </p>
        <ActionForm action={createBusiness} className="mt-6 flex flex-col gap-4">
          {(state) => (
            <>
              <Field label="Business name" htmlFor="businessName">
                <input id="businessName" name="businessName" required maxLength={120} autoFocus placeholder="e.g. Glow Beauty Salon" className="control" />
              </Field>
              {/* The browser's zone, so booking times are right from the start. */}
              <input type="hidden" name="timezone" ref={(el) => void (el && (el.value = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""))} />
              <SubmitButton variant="primary" pendingText="Creating…">
                Create my business
              </SubmitButton>
              <ActionStatus state={state} />
            </>
          )}
        </ActionForm>
      </div>
    </div>
  );
}
