import { CalendarCheck2, CalendarX2 } from "lucide-react";
import { ConfirmButton, SubmitButton } from "./forms";
import { Badge, Card, Notice } from "./ui";
import { connectGoogleCalendar, disconnectGoogleCalendar } from "@/app/settings/actions";
import type { GoogleStatus } from "@/lib/data";

/** Google Calendar connection — shown on both Settings › Integrations and Bookings › Setup. */
export function GoogleCalendarCard({ google, result }: { google: GoogleStatus; result?: string }) {
  return (
    <Card>
      {result === "connected" && (
        <div className="px-5 pt-5">
          <Notice tone="brand">Google Calendar connected — new bookings will appear on it automatically.</Notice>
        </div>
      )}
      {result === "error" && (
        <div className="px-5 pt-5">
          <Notice tone="danger">Couldn&apos;t connect Google Calendar. Please try again.</Notice>
        </div>
      )}
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-subtle">
          {google.connected ? <CalendarCheck2 className="size-5 text-brand" /> : <CalendarX2 className="size-5 text-faint" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">Google Calendar</p>
            {google.connected ? (
              <Badge tone="brand" dot>
                Connected
              </Badge>
            ) : (
              <Badge>Not connected</Badge>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted">
            {google.connected
              ? `Bookings sync to ${google.connectedEmail ?? "your calendar"}, and the assistant won't offer times you're already busy.`
              : "Connect so the assistant checks your real availability and adds bookings to your calendar."}
          </p>
        </div>
        {google.connected ? (
          <ConfirmButton
            action={disconnectGoogleCalendar}
            confirmText="Disconnect Google Calendar? The assistant will stop checking your availability."
            variant="secondary"
          >
            Disconnect
          </ConfirmButton>
        ) : (
          <form action={connectGoogleCalendar}>
            <SubmitButton pendingText="Redirecting…">Connect</SubmitButton>
          </form>
        )}
      </div>
    </Card>
  );
}
