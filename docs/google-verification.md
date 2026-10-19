# Google OAuth data-access verification

Branding verification is done. This is the second review: approval of the
sensitive Calendar scopes, which lifts the "unverified app" screen and the
100-user cap.

Google Cloud Console → Google Auth Platform → **Data Access** must list
exactly these two scopes (anything extra keeps the app unverified):

- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/calendar.freebusy`

Privacy policy: https://captus.cc/privacy.html (section "Google user data"
has the Limited Use statement).

## Scope justifications (paste into the form)

**calendar.events**

> Captus is a WhatsApp assistant that takes bookings for small businesses.
> When a customer books an appointment through the business's WhatsApp
> chat, Captus creates an event for it in the business owner's own Google
> Calendar, and deletes that event when the customer cancels or reschedules.
> Captus only creates and deletes events it made itself; it never reads,
> edits or deletes the owner's other events. We also read the primary
> calendar's ID to show the owner which account is connected. The narrower
> calendar.events.owned / calendar.app.created scopes don't fit: bookings
> must appear on the owner's primary calendar, where they actually look
> at their day, not in a separate app-made calendar.

**calendar.freebusy**

> Before offering a customer a booking slot, Captus checks when the
> business owner is busy, so it never offers a time that clashes with
> something already in their calendar (leave, a private appointment, a
> booking taken by phone). Only busy/free time ranges are read — no event
> titles, attendees or details.

**How the data is used / stored** (if asked)

> Busy/free ranges are used at the moment of the booking request and not
> stored. Created event IDs are stored so the event can be removed on
> cancellation. OAuth tokens are stored encrypted. Disconnecting in the
> Captus dashboard revokes the token with Google and deletes it. Google
> user data is not sold, not used for ads, and not used to train AI models.

## Demo video (unlisted YouTube, 2–3 min, English UI, narrate or caption)

1. Show the browser address bar at **https://app.captus.cc** and sign in.
2. Go to **Settings → Integrations** (or Bookings → Setup) and click
   **Connect Google Calendar**.
3. On Google's consent screen, pause on it: the app name **Captus**, the
   logo, and both permissions must be readable. Zoom if needed. If the
   URL bar can show the `client_id=` parameter, keep it visible for a
   moment — reviewers match it to the project.
4. Approve, and show the dashboard now saying the calendar is connected
   (with the account email).
5. **freebusy:** in Google Calendar, create a block, e.g. "Dentist" tomorrow
   3–4pm. On a phone, ask the WhatsApp assistant for a slot tomorrow
   afternoon → it doesn't offer 3pm.
6. **events:** book a free slot by WhatsApp → open Google Calendar, show
   the booking event appear.
7. Cancel it by WhatsApp → show the event disappear from Google Calendar.
8. Back in the dashboard, click **Disconnect**, then show
   https://myaccount.google.com/permissions no longer lists Captus.

## Before submitting

- Gemini on the **paid** tier. The policy says Google user data isn't
  used to train AI models; on the free Gemini tier, Google may use
  prompts (which include free-slot information) to improve its models,
  so that statement is only true on the paid tier.
- Publishing status = **In production**.
- Verification Center → submit, then reply quickly to review emails.
