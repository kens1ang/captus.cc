"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { ActionForm, FormFooter } from "@/components/forms";
import { Button, cx } from "@/components/ui";
import type { ActionState } from "@/lib/actionState";

type Row = Record<string, string> & { _key: string };

let nextKey = 0;
const withKey = (row: Record<string, string>): Row => ({ ...row, _key: `r${nextKey++}` });
const withoutKey = (row: Row): Record<string, string> => Object.fromEntries(Object.entries(row).filter(([k]) => k !== "_key"));

export interface ColumnSpec {
  name: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  /** Grid span within the row's 6-column layout. */
  span?: 2 | 3 | 4 | 6;
  required?: boolean;
}

/**
 * Editable list of items (products, FAQs) with add / remove / reorder,
 * submitted as one JSON `payload` field. Rows missing a required field are
 * dropped server-side, so the footer warns about them before saving rather
 * than letting a half-typed row silently disappear.
 */
export function ListEditor({
  action,
  initialItems,
  columns,
  itemLabel,
  emptyText,
  extraData,
  extraFields,
  suggestions,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  initialItems: Record<string, string>[];
  columns: ColumnSpec[];
  itemLabel: string;
  emptyText: string;
  /** Additional non-list fields saved alongside, e.g. products' general notes. */
  extraData?: Record<string, string>;
  extraFields?: (value: Record<string, string>, set: (name: string, v: string) => void) => ReactNode;
  /** One-click starter rows, e.g. common FAQ questions. Hidden once used. */
  suggestions?: { label: string; row: Record<string, string> }[];
}) {
  const blank = Object.fromEntries(columns.map((c) => [c.name, ""]));
  const [rows, setRows] = useState<Row[]>(() => (initialItems.length ? initialItems.map(withKey) : [withKey(blank)]));
  const [extra, setExtra] = useState<Record<string, string>>(extraData ?? {});

  const required = columns.filter((c) => c.required).map((c) => c.name);
  const isEmpty = (r: Row) => columns.every((c) => !r[c.name]?.trim());
  const incomplete = rows.filter((r) => !isEmpty(r) && required.some((n) => !r[n]?.trim())).length;
  const items = rows.filter((r) => !isEmpty(r)).map(withoutKey);

  const update = (key: string, name: string, value: string) => setRows((rs) => rs.map((r) => (r._key === key ? { ...r, [name]: value } : r)));
  const remove = (key: string) => setRows((rs) => (rs.length === 1 ? [withKey(blank)] : rs.filter((r) => r._key !== key)));
  const move = (index: number, dir: -1 | 1) =>
    setRows((rs) => {
      const next = [...rs];
      const [row] = next.splice(index, 1);
      next.splice(index + dir, 0, row);
      return next;
    });
  const add = (row: Record<string, string> = blank) =>
    setRows((rs) => {
      // Fill the trailing empty row instead of stacking a new one under it.
      const last = rs[rs.length - 1];
      return last && isEmpty(last) ? [...rs.slice(0, -1), withKey({ ...blank, ...row })] : [...rs, withKey({ ...blank, ...row })];
    });

  const availableSuggestions = suggestions?.filter((s) => !rows.some((r) => columns.some((c) => s.row[c.name] && r[c.name] === s.row[c.name])));

  return (
    <ActionForm action={action}>
      <input type="hidden" name="payload" value={JSON.stringify({ ...extra, items })} />
      <div className="flex flex-col gap-3 p-5">
        {rows.map((row, i) => (
          <div key={row._key} className="group relative rounded-lg border border-line bg-canvas/50 p-4 transition-colors focus-within:border-line-strong">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium text-faint">
                {itemLabel} {i + 1}
              </span>
              <div className="flex items-center gap-0.5 opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-30" aria-label="Move up">
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === rows.length - 1}
                  className="rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-30"
                  aria-label="Move down"
                >
                  <ArrowDown className="size-3.5" />
                </button>
                <button type="button" onClick={() => remove(row._key)} className="rounded p-1 text-muted hover:bg-danger-soft hover:text-danger" aria-label={`Remove ${itemLabel.toLowerCase()}`}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-6 gap-3">
              {columns.map((col) => {
                const missing = col.required && !isEmpty(row) && !row[col.name]?.trim();
                const props = {
                  value: row[col.name] ?? "",
                  onChange: (e: { target: { value: string } }) => update(row._key, col.name, e.target.value),
                  placeholder: col.placeholder,
                  "aria-label": col.label,
                  className: cx("control", missing && "border-warn/60"),
                };
                return (
                  <label key={col.name} className={cx("flex flex-col gap-1.5", { 2: "col-span-6 sm:col-span-2", 3: "col-span-6 sm:col-span-3", 4: "col-span-6 sm:col-span-4", 6: "col-span-6" }[col.span ?? 6])}>
                    <span className="text-xs font-medium text-muted">{col.label}</span>
                    {col.multiline ? <textarea rows={2} {...props} /> : <input {...props} />}
                  </label>
                );
              })}
            </div>
          </div>
        ))}

        <Button type="button" variant="secondary" onClick={() => add()} className="self-start">
          <Plus className="size-4" /> Add {itemLabel.toLowerCase()}
        </Button>

        {availableSuggestions && availableSuggestions.length > 0 && (
          <div className="mt-2 rounded-lg border border-dashed border-line p-4">
            <p className="mb-2.5 text-xs font-medium text-muted">Common questions — click to add, then write your answer</p>
            <div className="flex flex-wrap gap-2">
              {availableSuggestions.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => add(s.row)}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted transition-colors hover:border-brand/50 hover:text-fg"
                >
                  <Plus className="size-3" /> {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {extraFields?.(extra, (name, v) => setExtra((e) => ({ ...e, [name]: v })))}

        {items.length === 0 && <p className="text-sm text-muted">{emptyText}</p>}
      </div>
      <FormFooter>
        {incomplete > 0 && (
          <span className="mr-auto text-sm text-warn">
            {incomplete} {incomplete === 1 ? itemLabel.toLowerCase() : `${itemLabel.toLowerCase()}s`} missing a required field won&apos;t be saved
          </span>
        )}
      </FormFooter>
    </ActionForm>
  );
}
