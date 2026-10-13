import { CalendarDays, X } from "lucide-react";
import { ConfirmButton } from "@/components/forms";
import { ButtonLink, Card, EmptyState } from "@/components/ui";
import { formatDate, formatPhone, formatTime } from "@/lib/formatDate";
import { getBookings, getServices, getSettings, type Booking } from "@/lib/data";
import { cancelBookingAction } from "./actions";

export default async function BookingsPage() {
  const [bookings, services, settings] = await Promise.all([getBookings(), getServices(), getSettings()]);
  const tz = settings.timezone;
  const upcoming = bookings.filter((b) => b.status === "confirmed");

  if (upcoming.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={CalendarDays}
          title="No upcoming bookings"
          description={
            services.length
              ? "When a customer books over WhatsApp, it shows up here and on your Google Calendar."
              : "Add a bookable service to let customers schedule appointments over WhatsApp."
          }
          action={
            !services.length && (
              <ButtonLink href="/bookings/setup" variant="primary">
                Set up bookings
              </ButtonLink>
            )
          }
        />
      </Card>
    );
  }

  const byDay = new Map<string, Booking[]>();
  for (const b of upcoming) {
    const day = formatDate(b.startsAt, tz);
    byDay.set(day, [...(byDay.get(day) ?? []), b]);
  }

  return (
    <div className="flex flex-col gap-6">
      {[...byDay].map(([day, list]) => (
        <section key={day}>
          <h2 className="mb-2 text-xs font-medium tracking-wider text-faint uppercase">
            {new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(new Date(list[0].startsAt))}
          </h2>
          <Card>
            <ul className="divide-y divide-line">
              {list.map((b) => (
                <li key={b.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="w-24 shrink-0">
                    <p className="text-sm font-semibold tabular-nums">{formatTime(b.startsAt, tz)}</p>
                    <p className="text-xs text-faint tabular-nums">to {formatTime(b.endsAt, tz)}</p>
                  </div>
                  <div className="h-9 w-0.5 shrink-0 rounded-full bg-brand/60" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{b.serviceName ?? "Appointment"}</p>
                    <p className="truncate text-xs text-muted">
                      {b.contactName ? `${b.contactName} · ` : ""}
                      <span className="font-mono">{formatPhone(b.contactWaNumber)}</span>
                    </p>
                  </div>
                  <ConfirmButton
                    action={cancelBookingAction.bind(null, b.id)}
                    confirmText="Cancel this booking? The customer will get a WhatsApp message saying it's been cancelled."
                    variant="danger"
                    title="Cancel booking"
                  >
                    <X className="size-3.5" /> Cancel
                  </ConfirmButton>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ))}
    </div>
  );
}
