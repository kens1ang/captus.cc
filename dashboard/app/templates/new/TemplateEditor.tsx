"use client";

import { useActionState, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Braces, ExternalLink, Phone, Plus, Reply, X } from "lucide-react";
import { ActionStatus, SubmitButton } from "@/components/forms";
import { TemplatePreview } from "@/components/TemplatePreview";
import { Button, Card, Field, cx } from "@/components/ui";
import { TEMPLATE_LANGUAGES } from "@/lib/templates";
import { createTemplateAction } from "../actions";

type Category = "UTILITY" | "MARKETING";
type EditorButton = { type: "QUICK_REPLY"; text: string } | { type: "URL"; text: string; url: string } | { type: "PHONE_NUMBER"; text: string; phone_number: string };

const CATEGORIES: { value: Category; label: string; hint: string }[] = [
  { value: "UTILITY", label: "Utility", hint: "Confirmations, reminders, order or account updates the customer expects." },
  { value: "MARKETING", label: "Marketing", hint: "Promotions, offers, announcements, re-engagement. Priced higher by Meta." },
];

/** Distinct {{n}} numbers in the text, ascending. */
function varNumbers(text: string): number[] {
  return [...new Set([...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

function Counter({ value, max }: { value: string; max: number }) {
  return <span className={cx("text-xs tabular-nums", value.length > max ? "text-danger" : "text-faint")}>{value.length}/{max}</span>;
}

export function TemplateEditor() {
  const [state, formAction] = useActionState(createTemplateAction, null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("UTILITY");
  const [language, setLanguage] = useState("en");
  const [header, setHeader] = useState("");
  const [headerSample, setHeaderSample] = useState("");
  const [body, setBody] = useState("");
  const [samples, setSamples] = useState<Record<number, string>>({});
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<EditorButton[]>([]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);

  // Put the cursor right after an inserted variable as part of the same
  // commit — a timeout could fire after the owner has already typed more,
  // and yank the cursor back mid-sentence.
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    bodyRef.current?.focus();
    bodyRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [body]);

  const bodyVars = useMemo(() => varNumbers(body), [body]);
  const headerHasVar = varNumbers(header).length > 0;
  const bodySamples = bodyVars.map((n) => samples[n] ?? "");

  function insertVariable() {
    const next = (bodyVars.at(-1) ?? 0) + 1;
    const token = `{{${next}}}`;
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    pendingCaret.current = start + token.length;
  }

  function updateButton(i: number, patch: Partial<EditorButton>) {
    setButtons(buttons.map((b, j) => (j === i ? ({ ...b, ...patch } as EditorButton) : b)));
  }

  function addButton(type: EditorButton["type"]) {
    const b: EditorButton =
      type === "URL" ? { type, text: "", url: "https://" } : type === "PHONE_NUMBER" ? { type, text: "Call us", phone_number: "+60" } : { type, text: "" };
    // Meta wants quick replies grouped together: keep them first, link/call buttons after.
    setButtons(type === "QUICK_REPLY" ? [...buttons.filter((x) => x.type === "QUICK_REPLY"), b, ...buttons.filter((x) => x.type !== "QUICK_REPLY")] : [...buttons, b]);
  }

  const payload = useMemo(() => {
    const components: unknown[] = [];
    if (header.trim()) {
      components.push({ type: "HEADER", format: "TEXT", text: header, ...(headerHasVar ? { example: { header_text: [headerSample] } } : {}) });
    }
    components.push({ type: "BODY", text: body, ...(bodyVars.length ? { example: { body_text: [bodySamples] } } : {}) });
    if (footer.trim()) components.push({ type: "FOOTER", text: footer });
    if (buttons.length) components.push({ type: "BUTTONS", buttons });
    return JSON.stringify({ name, language, category, components });
  }, [name, language, category, header, headerHasVar, headerSample, body, bodyVars, bodySamples, footer, buttons]);

  const counts = {
    quick: buttons.filter((b) => b.type === "QUICK_REPLY").length,
    url: buttons.filter((b) => b.type === "URL").length,
    phone: buttons.filter((b) => b.type === "PHONE_NUMBER").length,
  };

  return (
    <form action={formAction} onReset={(e) => e.preventDefault()} className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <input type="hidden" name="payload" value={payload} />

      <div className="flex flex-col gap-6">
        <Card>
          <div className="grid gap-5 p-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Name" htmlFor="tpl-name" hint="Lowercase letters, numbers and underscores. Only you see this — customers don't.">
                <input
                  id="tpl-name"
                  required
                  maxLength={512}
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, ""))}
                  placeholder="e.g. order_ready"
                  className="control font-mono"
                />
              </Field>
            </div>
            <Field label="Category" htmlFor="tpl-category" hint={CATEGORIES.find((c) => c.value === category)?.hint}>
              <select id="tpl-category" value={category} onChange={(e) => setCategory(e.target.value as Category)} className="control">
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Language" htmlFor="tpl-language" hint="Make one template per language you message customers in.">
              <select id="tpl-language" value={language} onChange={(e) => setLanguage(e.target.value)} className="control">
                {TEMPLATE_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Card>

        <Card>
          <div className="flex flex-col gap-5 p-5">
            <Field label="Header" htmlFor="tpl-header" optional hint={<Counter value={header} max={60} />}>
              <input id="tpl-header" value={header} onChange={(e) => setHeader(e.target.value)} maxLength={60} placeholder="e.g. Your order is ready" className="control" />
            </Field>
            {headerHasVar && (
              <Field label="Sample for header {{1}}" htmlFor="tpl-header-sample">
                <input id="tpl-header-sample" value={headerSample} onChange={(e) => setHeaderSample(e.target.value)} className="control" placeholder="e.g. Aisyah" />
              </Field>
            )}

            <Field
              label="Body"
              htmlFor="tpl-body"
              hint={
                <span className="flex items-center justify-between gap-3">
                  <span>
                    Use {"{{1}}"}, {"{{2}}"}… for details that change per customer. *bold* _italic_ ~strike~ work too.
                  </span>
                  <Counter value={body} max={1024} />
                </span>
              }
            >
              <textarea
                id="tpl-body"
                ref={bodyRef}
                required
                rows={6}
                maxLength={1024}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={"Hi {{1}}, your order {{2}} is ready for pickup. See you soon!"}
                className="control resize-y"
              />
            </Field>
            <div className="-mt-3">
              {/* preventDefault on mousedown keeps focus (and the cursor position) in the body, so typing continues there instead of on this button — where every space would press it again. */}
              <Button type="button" size="sm" variant="secondary" onMouseDown={(e) => e.preventDefault()} onClick={insertVariable}>
                <Braces className="size-3.5" /> Add variable
              </Button>
            </div>

            {bodyVars.length > 0 && (
              <div className="rounded-md border border-line bg-subtle/60 p-4">
                <p className="text-sm font-medium">Sample values</p>
                <p className="mt-0.5 text-xs text-muted">Meta needs an example for each variable to review the template. Use realistic values.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {bodyVars.map((n) => (
                    <label key={n} className="flex items-center gap-2">
                      <span className="w-10 shrink-0 font-mono text-xs text-info">{`{{${n}}}`}</span>
                      <input
                        value={samples[n] ?? ""}
                        onChange={(e) => setSamples({ ...samples, [n]: e.target.value })}
                        required
                        aria-label={`Sample value for variable ${n}`}
                        className="control"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            <Field label="Footer" htmlFor="tpl-footer" optional hint={<Counter value={footer} max={60} />}>
              <input id="tpl-footer" value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={60} placeholder="e.g. Reply STOP to opt out" className="control" />
            </Field>
          </div>
        </Card>

        <Card>
          <div className="flex flex-col gap-4 p-5">
            <div>
              <p className="text-sm font-medium">Buttons <span className="text-xs font-normal text-faint">Optional</span></p>
              <p className="mt-0.5 text-xs text-muted">Quick replies let customers answer with one tap. Website and call buttons open a link or dial a number.</p>
            </div>

            {buttons.map((b, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2 rounded-md border border-line p-3">
                <span className="mt-2 text-faint">
                  {b.type === "URL" ? <ExternalLink className="size-4" /> : b.type === "PHONE_NUMBER" ? <Phone className="size-4" /> : <Reply className="size-4" />}
                </span>
                <input
                  value={b.text}
                  onChange={(e) => updateButton(i, { text: e.target.value })}
                  maxLength={25}
                  required
                  placeholder="Button text"
                  aria-label="Button text"
                  className="control min-w-0 flex-1 basis-32"
                />
                {b.type === "URL" && (
                  <input
                    value={b.url}
                    onChange={(e) => updateButton(i, { url: e.target.value })}
                    type="url"
                    required
                    aria-label="Website URL"
                    className="control min-w-0 flex-[2] basis-48"
                  />
                )}
                {b.type === "PHONE_NUMBER" && (
                  <input
                    value={b.phone_number}
                    onChange={(e) => updateButton(i, { phone_number: e.target.value.replace(/[^\d+]/g, "") })}
                    type="tel"
                    required
                    aria-label="Phone number"
                    className="control min-w-0 flex-[2] basis-40 font-mono"
                  />
                )}
                <Button type="button" size="sm" variant="ghost" className="mt-1" onClick={() => setButtons(buttons.filter((_, j) => j !== i))} aria-label="Remove button" title="Remove button">
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}

            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={buttons.length >= 10} onClick={() => addButton("QUICK_REPLY")}>
                <Plus className="size-3.5" /> Quick reply
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={counts.url >= 2 || buttons.length >= 10} onClick={() => addButton("URL")}>
                <Plus className="size-3.5" /> Website
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={counts.phone >= 1 || buttons.length >= 10} onClick={() => addButton("PHONE_NUMBER")}>
                <Plus className="size-3.5" /> Call
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <div className="flex flex-col gap-4 lg:sticky lg:top-6">
        <Card className="overflow-hidden">
          <p className="border-b border-line px-5 py-3 text-sm font-semibold">Preview</p>
          <div className="min-h-48 bg-wa-chat px-5 py-6">
            <TemplatePreview
              header={header || undefined}
              headerSample={headerSample}
              body={body}
              bodySamples={bodySamples}
              footer={footer || undefined}
              buttons={buttons}
            />
          </div>
        </Card>
        <div className="flex flex-col gap-3">
          <SubmitButton pendingText="Submitting…" className="w-full">
            Submit for review
          </SubmitButton>
          <ActionStatus state={state} />
          <p className="text-xs text-muted">
            Meta usually reviews within minutes, sometimes up to 24 hours. Approved templates can be edited only a few times, so double-check before submitting.
          </p>
        </div>
      </div>
    </form>
  );
}
