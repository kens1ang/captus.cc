import Link from "next/link";
import { ArrowRight, Building2, CircleHelp, FileText, MapPin, Package, ScrollText, StickyNote, type LucideIcon } from "lucide-react";
import { Badge, Page, PageHeader } from "@/components/ui";
import { ImportCard } from "@/components/ImportCard";
import { formatRelative } from "@/lib/formatDate";
import {
  buildSetupSteps,
  getBusinessHours,
  getBusinessInfo,
  getDocuments,
  getGoogleStatus,
  getImportState,
  getKnowledgeChunks,
  getServices,
  getSettings,
} from "@/lib/data";

interface Tile {
  href: string;
  title: string;
  icon: LucideIcon;
  summary: string;
  done?: boolean;
  updatedAt?: string;
}

function TileGrid({ tiles, timezone }: { tiles: Tile[]; timezone: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {tiles.map(({ href, title, icon: Icon, summary, done, updatedAt }) => (
        <Link
          key={href}
          href={href}
          className="group flex items-start gap-3.5 rounded-lg border border-line bg-panel p-4 shadow-xs transition-colors hover:border-line-strong"
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-subtle text-muted group-hover:text-brand">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{title}</p>
              {done !== undefined &&
                (done ? (
                  <Badge tone="brand" dot>
                    Done
                  </Badge>
                ) : (
                  <Badge>To do</Badge>
                ))}
            </div>
            <p className="mt-0.5 text-sm text-muted">{summary}</p>
            {updatedAt && <p className="mt-2 text-xs text-faint">Updated {formatRelative(updatedAt, timezone)}</p>}
          </div>
          <ArrowRight className="mt-0.5 size-4 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
        </Link>
      ))}
    </div>
  );
}

function Group({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-sm text-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export default async function KnowledgeOverviewPage() {
  const [info, hours, documents, google, services, chunks, settings, importState] = await Promise.all([
    getBusinessInfo(),
    getBusinessHours(),
    getDocuments(),
    getGoogleStatus(),
    getServices(),
    getKnowledgeChunks(),
    getSettings(),
    // Best-effort — the import card is a shortcut, not something to take the page down over.
    getImportState().catch(() => null),
  ]);
  const tz = settings.timezone;
  const done = Object.fromEntries(buildSetupSteps({ info, hours, documents, google, services }).map((s) => [s.key, s.done]));
  const s = info.sections;
  const openDays = new Set(hours.map((h) => h.dayOfWeek)).size;
  const policyCount = s.policies ? Object.values(s.policies.data).filter((v) => v.trim()).length : 0;
  const notes = chunks.filter((c) => !c.source?.startsWith("section:"));

  return (
    <Page>
      <PageHeader
        title="Knowledge"
        description="Everything your assistant knows about your business. It only answers from what's here — anything missing gets handed to you instead of guessed."
      />

      <ImportCard initial={importState} />

      <Group title="Always known" description="Included in every reply, so the basics are never missed.">
        <TileGrid
          timezone={tz}
          tiles={[
            {
              href: "/knowledge/profile",
              title: "Business profile",
              icon: Building2,
              summary: info.businessDescription ? info.businessDescription.slice(0, 90) + (info.businessDescription.length > 90 ? "…" : "") : "What you do, who you serve, what makes you different.",
              done: done.profile,
              updatedAt: s.profile?.updatedAt,
            },
            {
              href: "/knowledge/location",
              title: "Location & hours",
              icon: MapPin,
              summary: openDays ? `Open ${plural(openDays, "day")} a week${s.location?.data.address ? ` · ${s.location.data.address}` : ""}` : "Address, contact details and opening hours.",
              done: done.location,
              updatedAt: s.location?.updatedAt,
            },
          ]}
        />
      </Group>

      <Group title="Looked up when relevant" description="Searched for each customer question — add as much detail as you like.">
        <TileGrid
          timezone={tz}
          tiles={[
            {
              href: "/knowledge/products",
              title: "Products & services",
              icon: Package,
              summary: s.products?.data.items.length ? plural(s.products.data.items.length, "item") : "What you sell and how much it costs.",
              done: done.products,
              updatedAt: s.products?.updatedAt,
            },
            {
              href: "/knowledge/policies",
              title: "Policies",
              icon: ScrollText,
              summary: policyCount ? plural(policyCount, "policy", "policies") + " set" : "Payment, delivery, refunds, cancellations.",
              done: done.policies,
              updatedAt: s.policies?.updatedAt,
            },
            {
              href: "/knowledge/faqs",
              title: "FAQs",
              icon: CircleHelp,
              summary: s.faqs?.data.items.length ? plural(s.faqs.data.items.length, "question") : "Questions customers ask, with your answers.",
              done: done.faqs,
              updatedAt: s.faqs?.updatedAt,
            },
            {
              href: "/knowledge/notes",
              title: "Other notes",
              icon: StickyNote,
              summary: notes.length ? plural(notes.length, "note") : "Paste anything else — an existing FAQ document, promotions, background.",
            },
          ]}
        />
      </Group>

      <Group title="Sent on request" description="Files the assistant can send when a customer asks for them.">
        <TileGrid
          timezone={tz}
          tiles={[
            {
              href: "/knowledge/files",
              title: "Files",
              icon: FileText,
              summary: documents.length ? documents.map((d) => d.name).join(", ") : "Menus, catalogs, price lists — PDF, image or spreadsheet.",
              done: done.files,
            },
          ]}
        />
      </Group>
    </Page>
  );
}
