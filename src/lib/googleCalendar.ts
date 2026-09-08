import { config } from "./config.js";
import { withTenant } from "../db/tenantContext.js";
import { getGoogleCalendarConnection } from "../db/googleCalendarConnections.js";

const OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

// Narrowest scopes that cover what we need: calendar.events (create/read/
// delete events — classified by Google as a "sensitive" scope) and
// calendar.freebusy (read busy/free only, non-sensitive). Deliberately NOT
// the full `calendar` scope (all calendars, all access) — that's "restricted"
// and would require Google's heavier CASA security assessment before every
// real client could use it, not just the lighter sensitive-scope review.
const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"];

export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // required to get a refresh_token back
    prompt: "consent", // forces a fresh refresh_token even on a reconnect (Google otherwise omits it after the first grant)
    state,
  });
  return `${OAUTH_BASE}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

/** One-time exchange of the OAuth `code` from the callback redirect for tokens. */
export async function exchangeCodeForTokens(code: string): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as TokenResponse;
  // access_type=offline + prompt=consent above guarantee this is present on
  // first connect; if it's ever missing, the flow is set up wrong upstream.
  if (!data.refresh_token) throw new Error("Google token exchange returned no refresh_token — check access_type/prompt params");
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

// Access tokens are short-lived (~1hr) but a reply-worker flush can need one
// every few seconds during a burst of bookings — cache per tenant in memory
// rather than exchanging the refresh token on every call.
const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getAccessToken(tenantId: string, refreshToken: string): Promise<string> {
  const cached = accessTokenCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google access token refresh failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as TokenResponse;
  accessTokenCache.set(tenantId, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

/** Loads the tenant's stored connection and returns a fresh access token, or null if not connected. */
async function getTenantAccessToken(tenantId: string): Promise<{ accessToken: string; calendarId: string } | null> {
  const connection = await withTenant(tenantId, (client) => getGoogleCalendarConnection(client));
  if (!connection) return null;
  const accessToken = await getAccessToken(tenantId, connection.refreshToken);
  return { accessToken, calendarId: connection.calendarId };
}

export interface BusyInterval {
  start: string; // ISO
  end: string;
}

/** Busy blocks already on the tenant's real calendar (meetings, holidays, anything not booked through Captus) in [timeMinISO, timeMaxISO). Returns [] if not connected — callers fall back to local-only availability. */
export async function queryFreeBusy(tenantId: string, timeMinISO: string, timeMaxISO: string): Promise<BusyInterval[]> {
  const conn = await getTenantAccessToken(tenantId);
  if (!conn) return [];

  const res = await fetch(`${CALENDAR_API_BASE}/freeBusy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${conn.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin: timeMinISO, timeMax: timeMaxISO, items: [{ id: conn.calendarId }] }),
  });
  if (!res.ok) throw new Error(`Google freeBusy query failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { calendars?: Record<string, { busy?: BusyInterval[] }> };
  return data.calendars?.[conn.calendarId]?.busy ?? [];
}

/** Creates the calendar event for a confirmed booking. Returns the Google event id (stored on the booking row). */
export async function createCalendarEvent(
  tenantId: string,
  input: { summary: string; description: string; startISO: string; endISO: string; timezone: string },
): Promise<string | null> {
  const conn = await getTenantAccessToken(tenantId);
  if (!conn) return null; // not connected — booking still proceeds, just isn't calendar-synced

  const res = await fetch(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(conn.calendarId)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${conn.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.startISO, timeZone: input.timezone },
      end: { dateTime: input.endISO, timeZone: input.timezone },
    }),
  });
  if (!res.ok) throw new Error(`Google event creation failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function deleteCalendarEvent(tenantId: string, eventId: string): Promise<void> {
  const conn = await getTenantAccessToken(tenantId);
  if (!conn) return;
  const res = await fetch(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(conn.calendarId)}/events/${eventId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${conn.accessToken}` },
  });
  // 410 Gone = already deleted on the Google side — not an error for us.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Google event deletion failed (${res.status}): ${await res.text()}`);
  }
}

/** The connected account's own address — calendar.events scope can't call the userinfo endpoint, so this reads it off the "primary" calendar's own id, which IS the account's email. */
export async function getPrimaryCalendarEmail(accessToken: string): Promise<string | null> {
  const res = await fetch(`${CALENDAR_API_BASE}/calendars/primary`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { id?: string };
  return data.id ?? null;
}

export async function revokeGoogleToken(refreshToken: string): Promise<void> {
  await fetch(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, { method: "POST" }).catch(() => {
    // Best-effort — the token is being deleted from our own DB regardless;
    // a failed revoke just means it lingers as valid on Google's side until it expires.
  });
}
