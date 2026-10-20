import Link from "next/link";
import { ArrowRight, BookOpen, CalendarDays, CheckCircle2, Circle, Inbox, MessagesSquare, Sparkles, TriangleAlert } from "lucide-react";
import { auth } from "@clerk/nextjs/server";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SignInScreen } from "@/components/SignInScreen";
import { ContactAvatar, StatusBadge } from "@/components/ConversationStatus";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, Page, PageHeader, cx } from "@/components/ui";
import { formatPhone, formatRange, formatRelative } from "@/lib/formatDate";
import {
  buildSetupSteps,
  getBookings,
  getBusinessHours,
  getBusinessInfo,
  getConversations,
  getDocuments,
  getGoogleStatus,
  getKnowledgeChunks,
  getMe,
  getServices,
  getSettings,
  needsAttention,
} from "@/lib/data";

function isWithinLastDay(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 86400_000;
}

export default async function OverviewPage() {
  // "/" is a public route (see proxy.ts) — signed-out visitors get sign-in here.
  const { userId } = await auth();
  if (!userId) return <SignInScreen hashRouting />;

  const [me, settings, conversations, info, hours, documents, google, services, bookings, chunks] = await Promise.all([
    getMe(),
    getSettings(),
    getConversations(),
    getBusinessInfo(),
    getBusinessHours(),
    getDocuments(),
    getGoogleStatus(),
    getServices(),
    getBookings(),
    getKnowledgeChunks(),
  ]);
  const tz = settings.timezone;
  const steps = buildSetupSteps({ info, hours, documents, google, services });
  const required = steps.filter((s) => !s.optional);
  const requiredDone = required.filter((s) => s.done).length;
  const allDone = steps.every((s) => s.done);
  const progress = Math.round((steps.filter((s) => s.done).length / steps.length) * 100);

  const needsYou = conversations.filter((c) => needsAttention(c.status));
  const activeToday = conversations.filter((c) => isWithinLastDay(c.lastMessageAt)).length;
  const upcoming = bookings.filter((b) => b.status === "confirmed");

  const stats = [
    { label: "Needs your reply", value: needsYou.length, icon: TriangleAlert, href: "/conversations?filter=needs_human", tone: needsYou.length ? "warn" : "" },
    { label: "Active in last 24h", value: activeToday, icon: MessagesSquare, href: "/conversations" },
    { label: "Upcoming bookings", value: upcoming.length, icon: CalendarDays, href: "/bookings" },
    { label: "Knowledge entries", value: chunks.length, icon: BookOpen, href: "/knowledge" },
  ];

  return (
    <Page wide>
      <AutoRefresh intervalMs={15000} />
      <PageHeader
        eyebrow={me.businessName}
        title="Overview"
        description="What your WhatsApp assistant is doing, and what still needs setting up."
        actions={
          <ButtonLink href="/conversations" variant="secondary">
            <Inbox className="size-4" /> Open inbox
          </ButtonLink>
        }
      />

      {!me.whatsappPhoneNumberId && (
        <Card>
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Your assistant isn&apos;t on WhatsApp yet</p>
              <p className="mt-0.5 text-sm text-muted">
                Fill in your knowledge and bookings, then try it out in the test chat. When you&apos;re happy with it, contact us at{" "}
                <a href="mailto:hello@captus.cc" className="underline underline-offset-2">hello@captus.cc</a> to connect your WhatsApp number.
              </p>
            </div>
            <ButtonLink href="/knowledge" variant="primary">
              <MessagesSquare className="size-4" /> Test your assistant
            </ButtonLink>
          </div>
        </Card>
      )}

      {!allDone && (
        <Card>
          <div className="flex flex-col gap-4 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-brand" />
                <h2 className="text-sm font-semibold">Set up your assistant</h2>
              </div>
              <p className="mt-0.5 text-sm text-muted">
                {requiredDone < required.length
                  ? `${required.length - requiredDone} essential step${required.length - requiredDone === 1 ? "" : "s"} left — the more it knows, the fewer chats it hands to you.`
                  : "Essentials done. The optional steps below make it even more useful."}
              </p>
            </div>
            <div className="flex items-center gap-3 sm:w-56">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle">
                <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-xs font-medium text-muted tabular-nums">{progress}%</span>
            </div>
          </div>
          <ul className="divide-y divide-line">
            {steps.map((step) => (
              <li key={step.key}>
                <Link href={step.href} className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-hover">
                  {step.done ? (
                    <CheckCircle2 className="size-5 shrink-0 text-brand" />
                  ) : (
                    <Circle className="size-5 shrink-0 text-line-strong" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={cx("text-sm font-medium", step.done ? "text-muted line-through decoration-faint" : "text-fg")}>
                      {step.title}
                      {step.optional && <span className="ml-2 text-xs font-normal text-faint no-underline">Optional</span>}
                    </p>
                    {!step.done && <p className="mt-0.5 text-sm text-muted">{step.description}</p>}
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, href, tone }) => (
          <Link
            key={label}
            href={href}
            className="group rounded-lg border border-line bg-panel p-4 shadow-xs transition-colors hover:border-line-strong"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted">{label}</p>
              <Icon className={cx("size-4", tone === "warn" ? "text-warn" : "text-faint")} />
            </div>
            <p className={cx("mt-3 text-3xl font-semibold tracking-tight tabular-nums", tone === "warn" && "text-warn")}>{value}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Recent conversations"
            description="Latest chats across all customers."
            actions={
              <ButtonLink href="/conversations" variant="ghost" size="sm">
                View all <ArrowRight className="size-3.5" />
              </ButtonLink>
            }
          />
          {conversations.length === 0 ? (
            <EmptyState
              icon={MessagesSquare}
              title="No conversations yet"
              description="When a customer messages your WhatsApp number, the chat shows up here."
            />
          ) : (
            <ul className="divide-y divide-line">
              {conversations.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <Link href={`/conversations/${c.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-hover">
                    <ContactAvatar waNumber={c.waNumber} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{formatPhone(c.waNumber)}</p>
                        {c.status !== "bot" && <StatusBadge status={c.status} />}
                      </div>
                      <p className="truncate text-sm text-muted">
                        {c.lastMessageDirection === "out" && <span className="text-faint">You: </span>}
                        {c.lastMessage ?? "—"}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-faint">{formatRelative(c.lastMessageAt, tz)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Next bookings"
            actions={
              <ButtonLink href="/bookings" variant="ghost" size="sm">
                View all <ArrowRight className="size-3.5" />
              </ButtonLink>
            }
          />
          {upcoming.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No upcoming bookings"
              description={services.length ? "Customers can book over WhatsApp — new ones appear here." : "Turn on bookings to let customers schedule over WhatsApp."}
              action={
                !services.length && (
                  <ButtonLink href="/bookings/setup" size="sm">
                    Set up bookings
                  </ButtonLink>
                )
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.slice(0, 5).map((b) => (
                <li key={b.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{b.serviceName ?? "Appointment"}</p>
                    <p className="truncate text-xs text-muted">{b.contactName ?? formatPhone(b.contactWaNumber)}</p>
                  </div>
                  <Badge>{formatRange(b.startsAt, b.endsAt, tz)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Page>
  );
}
