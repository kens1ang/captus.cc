"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, Globe, Loader2, Sparkles, X } from "lucide-react";
import { applyImport, dismissImport, getImport, startImport } from "@/app/knowledge/importActions";
import type { ImportDraft, ImportPart, ImportState } from "@/lib/data";
import { POLICY_FIELDS } from "@/lib/policies";
import { Badge, Button, Card, Field, Notice, cx } from "@/components/ui";

const POLL_MS = 2500;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PART_LABELS: Record<ImportPart, string> = {
  profile: "Business profile",
  location: "Contact & location",
  hours: "Opening hours",
  products: "Products & services",
  policies: "Policies",
  faqs: "FAQs",
};

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** What the draft actually has, per part — parts with nothing found aren't offered at all. */
function draftParts(d: ImportDraft): { part: ImportPart; summary: string; body: ReactNode }[] {
  const out: { part: ImportPart; summary: string; body: ReactNode }[] = [];
  const profile = [d.businessDescription, d.profile.highlights, d.profile.audience].filter(Boolean);
  if (profile.length) {
    out.push({
      part: "profile",
      summary: "Description of your business",
      body: profile.map((t, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {t}
        </p>
      )),
    });
  }
  const loc = d.location;
  const locRows = (
    [
      ["Address", loc.address],
      ["Phone", loc.phone],
      ["Email", loc.email],
      ["Website", loc.website],
      ["Social media", loc.socials],
      ["Service area", loc.serviceArea],
      ["Getting here", loc.directions],
      ["Other outlets / notes", loc.hoursNotes],
    ] as const
  ).filter(([, v]) => v);
  if (locRows.length) {
    out.push({
      part: "location",
      summary: locRows.map(([k]) => k).join(", "),
      body: (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {locRows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="break-words whitespace-pre-wrap">{v}</dd>
            </div>
          ))}
        </dl>
      ),
    });
  }
  if (d.hours.length) {
    const days = new Set(d.hours.map((h) => h.dayOfWeek)).size;
    out.push({
      part: "hours",
      summary: `Open ${plural(days, "day")} a week`,
      body: (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {[1, 2, 3, 4, 5, 6, 0].map((day) => {
            const hs = d.hours.filter((h) => h.dayOfWeek === day);
            return (
              <div key={day} className="contents">
                <dt className="text-muted">{DAY_NAMES[day]}</dt>
                <dd>{hs.length ? hs.map((h) => `${h.startTime}–${h.endTime}`).join(", ") : "Closed"}</dd>
              </div>
            );
          })}
        </dl>
      ),
    });
  }
  if (d.products.length) {
    out.push({
      part: "products",
      summary: plural(d.products.length, "item"),
      body: (
        <ul className="flex flex-col gap-1">
          {d.products.map((p, i) => (
            <li key={i} className="flex justify-between gap-4">
              <span className="min-w-0">
                {p.name}
                {p.description && <span className="text-muted"> — {p.description}</span>}
              </span>
              <span className="shrink-0 font-medium">{p.price || <span className="font-normal text-faint">no price</span>}</span>
            </li>
          ))}
        </ul>
      ),
    });
  }
  const policies = POLICY_FIELDS.filter((f) => d.policies[f.key]);
  if (policies.length) {
    out.push({
      part: "policies",
      summary: policies.map((f) => f.label).join(", "),
      body: policies.map((f) => (
        <p key={f.key}>
          <span className="text-muted">{f.label}: </span>
          {d.policies[f.key]}
        </p>
      )),
    });
  }
  if (d.faqs.length) {
    out.push({
      part: "faqs",
      summary: plural(d.faqs.length, "question"),
      body: d.faqs.map((f, i) => (
        <div key={i}>
          <p className="font-medium">{f.question}</p>
          <p className="text-muted">{f.answer}</p>
        </div>
      )),
    });
  }
  return out;
}

function Sources({ sources }: { sources: NonNullable<ImportState["sources"]> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {sources.map((s, i) => (
        <span key={i} title={s.url} className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", s.ok ? "border-line text-muted" : "border-line text-faint")}>
          {s.ok ? <Check className="size-3 text-brand" /> : <X className="size-3" />}
          {s.label}
          {s.note && <span className="text-faint">· {s.note}</span>}
        </span>
      ))}
    </div>
  );
}

function LinksForm({ initialUrls, onStart, busy, error }: { initialUrls: string[]; onStart: (urls: string[]) => void; busy: boolean; error: string | null }) {
  const isSocial = (u: string) => /instagram|facebook|fb\.|tiktok|x\.com|twitter|linkedin|youtube|xiaohongshu|xhslink|goo\.gl|g\.page|google\.|shopee|lazada|grab|foodpanda/i.test(u);
  const [website, setWebsite] = useState(initialUrls.find((u) => !isSocial(u)) ?? "");
  const [socials, setSocials] = useState(initialUrls.filter(isSocial).join("\n"));

  function submit(e: FormEvent) {
    e.preventDefault();
    const urls = [website, ...socials.split(/[\s,]+/)].map((u) => u.trim()).filter(Boolean);
    if (urls.length) onStart(urls);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Website" htmlFor="import-website" optional>
          <input id="import-website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="e.g. glowbeauty.my" className="control" />
        </Field>
        <Field label="Social media & Google Maps" htmlFor="import-socials" optional hint="One link per line — Instagram, Facebook, TikTok, Google Maps…">
          <textarea
            id="import-socials"
            value={socials}
            onChange={(e) => setSocials(e.target.value)}
            rows={2}
            placeholder={"instagram.com/glowbeauty\nfacebook.com/glowbeauty"}
            className="control min-h-16 resize-y"
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={busy || !(website.trim() || socials.trim())}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          Fill in from my links
        </Button>
        {error && (
          <span className="inline-flex items-center gap-1.5 text-sm text-danger">
            <CircleAlert className="size-4" />
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

/**
 * Knowledge overview: "fill this in from my website / socials". Start →
 * runs in the background (polled) → review what was found → add the chosen
 * parts. Adding only fills empty fields and appends new products/FAQs.
 */
export function ImportCard({ initial }: { initial: ImportState | null }) {
  const router = useRouter();
  const [state, setState] = useState<ImportState | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unchecked, setUnchecked] = useState<Set<ImportPart>>(new Set());
  const [applied, setApplied] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const running = state?.status === "running";

  useEffect(() => {
    if (!running) return;
    const poll = setInterval(async () => {
      const res = await getImport();
      if (res.ok) setState(res.import);
    }, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [running]);

  async function start(urls: string[]) {
    setBusy(true);
    setError(null);
    setApplied(null);
    const res = await startImport(urls);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setUnchecked(new Set());
    setNow(Date.now());
    setState(res.import);
  }

  async function apply(parts: ImportPart[]) {
    setBusy(true);
    setError(null);
    const res = await applyImport(parts);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    const added = Object.entries(res.applied).filter(([, n]) => n);
    setApplied(
      added.length
        ? `Added to your Knowledge: ${added.map(([p]) => PART_LABELS[p as ImportPart]).join(", ")}. Have a look through each page and fix anything that's off.`
        : "Nothing new to add — those parts were already filled in.",
    );
    setState(null);
    router.refresh();
  }

  async function discard() {
    setState(null);
    setError(null);
    await dismissImport().catch(() => undefined);
  }

  const header = (
    <div className="flex items-start gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-brand/25 bg-brand-soft text-brand-strong">
        <Globe className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold">Fill in from your website & social media</p>
        <p className="text-sm text-muted">
          We read your links and draft your Knowledge pages for you to check — prices, hours, contact details, FAQs. Nothing is saved until you
          review it.
        </p>
      </div>
    </div>
  );

  if (running) {
    const seconds = Math.max(0, Math.round((now - Date.parse(state.startedAt)) / 1000));
    return (
      <Card className="flex flex-col gap-4 p-5">
        {header}
        <div className="flex items-center gap-3 rounded-md border border-line bg-subtle px-4 py-3">
          <Loader2 className="size-4 shrink-0 animate-spin text-brand" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">{state.step ?? "Working…"}</p>
            <p className="text-muted">Usually 15–40 seconds. You can keep working — this updates by itself.</p>
          </div>
          <span className="text-xs text-faint tabular-nums">{seconds}s</span>
        </div>
      </Card>
    );
  }

  if (state?.status === "done" && state.draft) {
    const parts = draftParts(state.draft);
    const chosen = parts.map((p) => p.part).filter((p) => !unchecked.has(p));
    const toggle = (part: ImportPart) =>
      setUnchecked((prev) => {
        const next = new Set(prev);
        if (next.has(part)) next.delete(part);
        else next.add(part);
        return next;
      });

    return (
      <Card className="flex flex-col gap-4 p-5">
        {header}
        {state.sources && <Sources sources={state.sources} />}
        {parts.length === 0 ? (
          <Notice tone="warn">We read your links but didn&apos;t find business details we could use. Fill in the pages below by hand, or try other links.</Notice>
        ) : (
          <>
            <p className="text-sm">Here&apos;s what we found. Untick anything you don&apos;t want, then add the rest.</p>
            <div className="flex flex-col divide-y divide-line rounded-md border border-line">
              {parts.map(({ part, summary, body }) => (
                <details key={part} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-hover">
                    <input
                      type="checkbox"
                      checked={!unchecked.has(part)}
                      onChange={() => toggle(part)}
                      onClick={(e) => e.stopPropagation()}
                      className="size-4 accent-brand"
                      aria-label={`Add ${PART_LABELS[part]}`}
                    />
                    <span className="text-sm font-medium">{PART_LABELS[part]}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted">{summary}</span>
                    <span className="text-xs text-faint group-open:hidden">Show</span>
                    <span className="hidden text-xs text-faint group-open:inline">Hide</span>
                  </summary>
                  <div className="flex max-h-80 flex-col gap-2 overflow-y-auto px-4 pb-4 pl-11 text-sm">{body}</div>
                </details>
              ))}
            </div>
            <Notice tone="info">
              Only empty fields are filled in, and new products and FAQs are added to your lists — nothing you&apos;ve already written is replaced. Opening
              hours are only set if you haven&apos;t entered any. Double-check prices and hours: your assistant will quote them to customers.
            </Notice>
          </>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {parts.length > 0 && (
            <Button variant="primary" disabled={busy || chosen.length === 0} onClick={() => apply(chosen)}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Add {chosen.length === parts.length ? "all" : chosen.length} to my Knowledge
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={discard}>
            Discard
          </Button>
          {error && (
            <span className="inline-flex items-center gap-1.5 text-sm text-danger">
              <CircleAlert className="size-4" />
              {error}
            </span>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      {header}
      {applied && (
        <Notice tone="brand">
          <span className="inline-flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0" />
            {applied}
          </span>
        </Notice>
      )}
      {state?.status === "failed" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Badge tone="danger">Import didn&apos;t work</Badge>
            <span className="text-sm text-muted">{state.error}</span>
          </div>
          {state.sources && <Sources sources={state.sources} />}
        </div>
      )}
      <LinksForm key={state?.startedAt ?? "new"} initialUrls={state?.urls ?? []} onStart={start} busy={busy} error={error} />
    </Card>
  );
}
