"use client";

import { Field } from "@/components/ui";
import type { ActionState } from "@/lib/actionState";
import type { ProductsData } from "@/lib/data";
import { ListEditor } from "../ListEditor";

export function ProductsEditor({
  action,
  initial,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: ProductsData;
}) {
  return (
    <ListEditor
      action={action}
      initialItems={(initial?.items ?? []).map((i) => ({ ...i }))}
      itemLabel="Item"
      emptyText="Nothing listed yet — add what you sell so the assistant can quote it."
      columns={[
        { name: "name", label: "Name", placeholder: "e.g. Iced Latte, Haircut (men), 1-hour massage", span: 4, required: true },
        { name: "price", label: "Price", placeholder: "e.g. RM 12, from RM 30, free", span: 2 },
        { name: "description", label: "Details", placeholder: "Sizes, options, what's included, duration…", multiline: true },
      ]}
      extraData={{ notes: initial?.notes ?? "" }}
      extraFields={(value, set) => (
        <div className="mt-4 border-t border-line pt-5">
          <Field
            label="General pricing notes"
            optional
            htmlFor="product-notes"
            hint="Applies to everything above — taxes, discounts, minimum orders, promotions."
          >
            <textarea
              id="product-notes"
              rows={3}
              value={value.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="e.g. Prices include 6% SST. 10% off for students with a valid ID. Minimum order RM 30 for delivery."
              className="control"
            />
          </Field>
        </div>
      )}
    />
  );
}
