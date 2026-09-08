import { backendFetch } from "@/lib/backend";
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  updateTimezone,
  addService,
  deleteServiceAction,
  saveBusinessHours,
} from "./actions";

interface GoogleStatus {
  connected: boolean;
  connectedEmail: string | null;
}

interface Service {
  id: string;
  name: string;
  durationMinutes: number;
}

interface BusinessHoursInterval {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

const DAYS = [
  { index: 0, name: "Sunday", key: "sun" },
  { index: 1, name: "Monday", key: "mon" },
  { index: 2, name: "Tuesday", key: "tue" },
  { index: 3, name: "Wednesday", key: "wed" },
  { index: 4, name: "Thursday", key: "thu" },
  { index: 5, name: "Friday", key: "fri" },
  { index: 6, name: "Saturday", key: "sat" },
];

export default async function SettingsPage(props: PageProps<"/settings">) {
  const searchParams = await props.searchParams;
  const googleParam = typeof searchParams.google === "string" ? searchParams.google : undefined;

  const [settings, google, services, hours] = await Promise.all([
    backendFetch<{ timezone: string }>("/api/settings"),
    backendFetch<GoogleStatus>("/api/google/status"),
    backendFetch<Service[]>("/api/services"),
    backendFetch<BusinessHoursInterval[]>("/api/business-hours"),
  ]);

  const hoursByDay = new Map(hours.map((h) => [h.dayOfWeek, h]));

  return (
    <div className="p-6 max-w-2xl mx-auto flex flex-col gap-8">
      <h1 className="text-lg font-semibold">Booking settings</h1>

      {googleParam === "connected" && (
        <p className="text-sm bg-green-50 text-green-800 border border-green-200 rounded px-3 py-2">Google Calendar connected.</p>
      )}
      {googleParam === "error" && (
        <p className="text-sm bg-red-50 text-red-800 border border-red-200 rounded px-3 py-2">
          Couldn&apos;t connect Google Calendar — please try again.
        </p>
      )}

      <section className="flex flex-col gap-2 border border-gray-200 rounded p-4">
        <h2 className="text-sm font-medium">Google Calendar</h2>
        {google.connected ? (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">Connected{google.connectedEmail ? ` as ${google.connectedEmail}` : ""}.</p>
            <form action={disconnectGoogleCalendar}>
              <button type="submit" className="text-xs text-red-600 hover:underline">
                Disconnect
              </button>
            </form>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Not connected — bookings won&apos;t sync to a real calendar until you connect one.</p>
            <form action={connectGoogleCalendar}>
              <button type="submit" className="px-3 py-2 rounded bg-gray-900 text-white text-sm whitespace-nowrap">
                Connect Google Calendar
              </button>
            </form>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2 border border-gray-200 rounded p-4">
        <h2 className="text-sm font-medium">Timezone</h2>
        <p className="text-xs text-gray-500">
          Used for reading business hours and for the bot to understand dates like &quot;tomorrow&quot; or &quot;next Tuesday&quot;. An IANA
          zone name, e.g. Asia/Singapore, Asia/Kuala_Lumpur, America/New_York.
        </p>
        <form action={updateTimezone} className="flex gap-2">
          <input
            name="timezone"
            defaultValue={settings.timezone}
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm font-mono"
            required
          />
          <button type="submit" className="px-3 py-2 rounded bg-gray-900 text-white text-sm">
            Save
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3 border border-gray-200 rounded p-4">
        <h2 className="text-sm font-medium">Services (bookable via WhatsApp)</h2>
        <form action={addService} className="flex gap-2">
          <input name="name" placeholder="Service name" className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm" required />
          <input
            name="durationMinutes"
            type="number"
            min={1}
            placeholder="Minutes"
            className="w-28 border border-gray-300 rounded px-3 py-2 text-sm"
            required
          />
          <button type="submit" className="px-3 py-2 rounded bg-gray-900 text-white text-sm">
            Add
          </button>
        </form>
        <ul className="flex flex-col gap-1">
          {services.map((s) => (
            <li key={s.id} className="flex items-center justify-between text-sm border border-gray-100 rounded px-3 py-2">
              <span>
                {s.name} <span className="text-gray-400">— {s.durationMinutes} min</span>
              </span>
              <form action={deleteServiceAction.bind(null, s.id)}>
                <button type="submit" className="text-xs text-red-600 hover:underline">
                  Delete
                </button>
              </form>
            </li>
          ))}
          {services.length === 0 && <p className="text-sm text-gray-400">No services yet — add one to let customers book via WhatsApp.</p>}
        </ul>
      </section>

      <section className="flex flex-col gap-3 border border-gray-200 rounded p-4">
        <h2 className="text-sm font-medium">Weekly business hours</h2>
        <p className="text-xs text-gray-500">One open interval per day. Leave a day&apos;s times blank (or check closed) if you&apos;re not open.</p>
        <form action={saveBusinessHours} className="flex flex-col gap-2">
          {DAYS.map((day) => {
            const existing = hoursByDay.get(day.index);
            return (
              <div key={day.key} className="flex items-center gap-2 text-sm">
                <span className="w-24">{day.name}</span>
                <input type="time" name={`${day.key}_start`} defaultValue={existing?.startTime} className="border border-gray-300 rounded px-2 py-1" />
                <span className="text-gray-400">to</span>
                <input type="time" name={`${day.key}_end`} defaultValue={existing?.endTime} className="border border-gray-300 rounded px-2 py-1" />
                <label className="flex items-center gap-1 text-xs text-gray-500 ml-2">
                  <input type="checkbox" name={`${day.key}_closed`} defaultChecked={!existing} />
                  Closed
                </label>
              </div>
            );
          })}
          <button type="submit" className="self-start px-4 py-2 rounded bg-gray-900 text-white text-sm mt-2">
            Save hours
          </button>
        </form>
      </section>
    </div>
  );
}
