// Every dashboard page previously rendered timestamps with plain
// `new Date(...).toLocaleString()`, which formats using the *viewer's
// browser* locale/timezone rather than the business's own — a real bug once
// confirmed live (a correctly-booked 2:30pm SGT appointment displayed as
// "6:30am" to a viewer outside Singapore time, looking like a nonsensical
// past booking). These helpers always take the tenant's configured
// timezone explicitly and always format as DD/MM/YYYY, regardless of the
// viewer's own locale.
const DATE_PARTS: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" };
const TIME_PARTS: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: true };

export function formatDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { ...DATE_PARTS, timeZone: timezone }).format(new Date(iso));
}

export function formatTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { ...TIME_PARTS, timeZone: timezone }).format(new Date(iso));
}

export function formatDateTime(iso: string, timezone: string): string {
  return `${formatDate(iso, timezone)}, ${formatTime(iso, timezone)}`;
}

export function formatRange(startISO: string, endISO: string, timezone: string): string {
  return `${formatDate(startISO, timezone)}, ${formatTime(startISO, timezone)} – ${formatTime(endISO, timezone)}`;
}

/** "just now" / "5m ago" / "3h ago" for recent times, falling back to the business-timezone date for older ones. */
export function formatRelative(iso: string, timezone: string, now: number = Date.now()): string {
  const diffSec = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 7 * 86400) return `${Math.floor(diffSec / 86400)}d ago`;
  return formatDate(iso, timezone);
}

/** "+60 12-345 6789"-ish grouping for a bare WhatsApp number (digits only, country code first). */
export function formatPhone(waNumber: string): string {
  const digits = waNumber.replace(/\D/g, "");
  if (digits.length < 8) return waNumber;
  return `+${digits.slice(0, digits.length - 8)} ${digits.slice(-8, -4)} ${digits.slice(-4)}`;
}
