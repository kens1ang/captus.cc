import { ExternalLink, Phone, Reply } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./ui";

export interface PreviewButton {
  type: string;
  text: string;
}

/**
 * WhatsApp-style rendering of a template's text: *bold*, _italic_, ~strike~,
 * and {{n}} variables — replaced by their sample value when one is given,
 * otherwise shown as a highlighted chip so the owner sees where it goes.
 */
function renderText(text: string, samples: string[] = []): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\{\{\s*\d+\s*\}\}|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = i++;
    if (tok.startsWith("{{")) {
      const n = Number(tok.replace(/\D/g, ""));
      const sample = samples[n - 1]?.trim();
      out.push(
        sample ? (
          <span key={key} className="rounded-sm bg-brand/15 px-0.5">
            {sample}
          </span>
        ) : (
          <span key={key} className="rounded-sm bg-info-soft px-1 font-mono text-[11px] text-info">
            {`{{${n}}}`}
          </span>
        ),
      );
    } else {
      // Formatting can wrap variables (e.g. *{{2}}*), so render the inside too.
      const inner = renderText(tok.slice(1, -1), samples);
      if (tok.startsWith("*")) out.push(<strong key={key}>{inner}</strong>);
      else if (tok.startsWith("_")) out.push(<em key={key}>{inner}</em>);
      else out.push(<s key={key}>{inner}</s>);
    }
    last = m.index! + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function ButtonIcon({ type }: { type: string }) {
  if (type === "URL") return <ExternalLink className="size-3.5" />;
  if (type === "PHONE_NUMBER") return <Phone className="size-3.5" />;
  return <Reply className="size-3.5" />;
}

/** A single outbound WhatsApp message bubble, as the customer will see the template. */
export function TemplatePreview({
  header,
  headerSample,
  body,
  bodySamples,
  footer,
  buttons = [],
  mediaHeader,
  compact,
}: {
  header?: string;
  headerSample?: string;
  body: string;
  bodySamples?: string[];
  footer?: string;
  buttons?: PreviewButton[];
  /** Non-text header format (IMAGE/VIDEO/DOCUMENT) — shown as a placeholder block. */
  mediaHeader?: string;
  compact?: boolean;
}) {
  return (
    <div className={cx("w-full", compact ? "max-w-sm" : "max-w-[19rem]")}>
      <div className="rounded-lg rounded-tl-none bg-wa-bubble px-2.5 pt-2 pb-1.5 text-[13px] leading-snug text-wa-text shadow-sm">
        {mediaHeader && (
          <div className="mb-1.5 flex h-24 items-center justify-center rounded-md bg-wa-chat text-xs text-wa-meta">
            {mediaHeader.toLowerCase()}
          </div>
        )}
        {header && <p className="mb-1 font-semibold">{renderText(header, headerSample ? [headerSample] : [])}</p>}
        <p className={cx("break-words whitespace-pre-wrap", compact && "line-clamp-4")}>
          {body ? renderText(body, bodySamples) : <span className="text-wa-meta">Your message…</span>}
        </p>
        {footer && <p className="mt-1 text-[11px] text-wa-meta">{footer}</p>}
        <p className="mt-0.5 text-right text-[10px] text-wa-meta">12:00</p>
      </div>
      {buttons.length > 0 && (
        <div className="mt-0.5 flex flex-col gap-0.5">
          {buttons.map((b, i) => (
            <div
              key={i}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-wa-bubble py-1.5 text-[13px] font-medium text-wa-link shadow-sm"
            >
              <ButtonIcon type={b.type} />
              {b.text || "Button"}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
