import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { ActionForm, FormFooter } from "@/components/forms";
import { GoogleCalendarCard } from "@/components/GoogleCalendarCard";
import { ServiceRow } from "@/components/ServiceRow";
import { Badge, Card, Field } from "@/components/ui";
import { getBusinessHours, getGoogleStatus, getServices } from "@/lib/data";
import { addService, deleteServiceAction, updateServiceAction } from "../actions";

export const metadata = { title: "Booking setup" };

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK = [1, 2, 3, 4, 5, 6, 0];

function Step({ n, title, description, children }: { n: number; title: string; description: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,5fr)] md:gap-8">
      <div className="flex gap-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-panel text-xs font-semibold text-muted">
          {n}
        </span>
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export default async function BookingSetupPage(props: PageProps<"/bookings/setup">) {
  const searchParams = await props.searchParams;
  const result = typeof searchParams.google === "string" ? searchParams.google : undefined;
  const [services, google, hours] = await Promise.all([getServices(), getGoogleStatus(), getBusinessHours()]);
  const openDays = WEEK.filter((d) => hours.some((h) => h.dayOfWeek === d));

  return (
    <div className="flex flex-col gap-10">
      <Step n={1} title="Bookable services" description="What customers can book, how long each takes, and how many customers you can take at the same time. Bookings stay off until you add one.">
        <Card>
          {services.length > 0 && (
            <ul className="divide-y divide-line border-b border-line">
              {services.map((s) => (
                <li key={s.id}>
                  <ServiceRow service={s} update={updateServiceAction.bind(null, s.id)} remove={deleteServiceAction.bind(null, s.id)} />
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={addService} resetOnSuccess>
            <div className="grid gap-4 p-5 sm:grid-cols-[1fr_8rem_9rem]">
              <Field label="Service name" htmlFor="svc-name">
                <input id="svc-name" name="name" required placeholder="e.g. Haircut, Consultation, Table for 4" className="control" />
              </Field>
              <Field label="Duration" htmlFor="svc-duration">
                <div className="relative">
                  <input id="svc-duration" name="durationMinutes" type="number" min={5} step={5} required defaultValue={30} className="control pr-12" />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-faint">min</span>
                </div>
              </Field>
              <Field label="Bookings at a time" htmlFor="svc-capacity">
                <input id="svc-capacity" name="capacity" type="number" min={1} max={100} step={1} required defaultValue={1} className="control" />
              </Field>
            </div>
            <p className="-mt-2 px-5 pb-4 text-xs text-muted">
              How many customers can be booked for the same time — e.g. 3 if you have 3 stylists or 5 tables. Leave at 1 if you
              only see one customer at a time.
            </p>
            <FormFooter submitLabel="Add service" pendingText="Adding…" />
          </ActionForm>
        </Card>
      </Step>

      <Step n={2} title="Connect your calendar" description="So the assistant never double-books you, and new bookings land on your calendar.">
        <GoogleCalendarCard google={google} result={result} />
      </Step>

      <Step n={3} title="Opening hours" description="Bookings are only offered inside these hours. Shared with Knowledge › Location & hours.">
        <Link
          href="/knowledge/location"
          className="group flex items-center gap-4 rounded-lg border border-line bg-panel p-4 shadow-xs transition-colors hover:border-line-strong"
        >
          <div className="min-w-0 flex-1">
            {openDays.length ? (
              <div className="flex flex-wrap gap-1.5">
                {WEEK.map((d) => (
                  <Badge key={d} tone={openDays.includes(d) ? "brand" : "neutral"}>
                    {DAY_SHORT[d]}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-warn">No opening hours set — customers can&apos;t book any time yet.</p>
            )}
          </div>
          <span className="flex items-center gap-1 text-sm font-medium text-muted group-hover:text-fg">
            Edit hours <ArrowRight className="size-4" />
          </span>
        </Link>
      </Step>
    </div>
  );
}
