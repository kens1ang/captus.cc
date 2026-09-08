import { backendFetch } from "@/lib/backend";
import { cancelBookingAction } from "./actions";

interface Booking {
  id: string;
  serviceName: string | null;
  contactWaNumber: string;
  contactName: string | null;
  startsAt: string;
  endsAt: string;
  status: "confirmed" | "cancelled";
}

// Bookings are a real-world commitment in the BUSINESS's own timezone, not
// whatever timezone the owner's browser happens to be set to — rendering
// with the default (browser-local) Date formatting previously made a
// perfectly valid future booking display as a nonsensical past one for
// anyone viewing the dashboard from outside that timezone. Always pass the
// tenant's configured timezone explicitly instead.
function formatRange(startISO: string, endISO: string, timezone: string): string {
  const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, dateStyle: "medium" });
  const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeStyle: "short" });
  const start = new Date(startISO);
  const end = new Date(endISO);
  return `${dateFmt.format(start)}, ${timeFmt.format(start)} – ${timeFmt.format(end)} (${timezone})`;
}

export default async function BookingsPage() {
  const [bookings, settings] = await Promise.all([
    backendFetch<Booking[]>("/api/bookings"),
    backendFetch<{ timezone: string }>("/api/settings"),
  ]);

  return (
    <div className="p-6 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Upcoming bookings</h1>

      <ul className="flex flex-col gap-2">
        {bookings.map((b) => (
          <li key={b.id} className="flex items-center justify-between border border-gray-200 rounded p-3 text-sm">
            <div>
              <p className="font-medium">{b.serviceName ?? "Unknown service"}</p>
              <p className="text-gray-500">{formatRange(b.startsAt, b.endsAt, settings.timezone)}</p>
              <p className="text-xs text-gray-400 font-mono mt-1">
                {b.contactName ? `${b.contactName} · ` : ""}
                {b.contactWaNumber}
              </p>
            </div>
            <form action={cancelBookingAction.bind(null, b.id)}>
              <button type="submit" className="text-xs text-red-600 hover:underline">
                Cancel
              </button>
            </form>
          </li>
        ))}
        {bookings.length === 0 && <p className="text-sm text-gray-400">No upcoming bookings.</p>}
      </ul>
    </div>
  );
}
