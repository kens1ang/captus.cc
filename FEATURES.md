# Captus features

What's built, and a backlog of what could come next. Effort is rough: **S** ≈ under a day, **M** ≈ 2–4 days, **L** ≈ a week or more.

---

## Built

### AI replies
- Answers 24/7 from the business's knowledge base: profile, location, products, policies, FAQs, notes, and uploaded files (RAG on pgvector).
- Refuses to invent prices, policies or promises. When it doesn't know, it says so.
- Remembers the conversation: the last 20 messages plus anything not yet summarised; older history is summarised.
- Debounce: a burst of quick messages gets one reply. A typing indicator shows while it works.
- Understands voice notes, photos and documents (PDF), not just text.
- Assistant settings: tone, languages (it replies in the customer's language), and custom instructions.

### Handover to a person
- **Handover**: the bot pauses and the owner takes over (e.g. "I want to talk to someone", complaints).
- **Flagged**: the bot keeps replying, but the chat is marked for the owner to check later.
- The owner gets a WhatsApp ping. The dashboard inbox shows "Needs you", and the owner can reply manually or resume the bot.
- If WhatsApp refuses a reply, the chat is handed to the owner rather than failing silently.

### Bookings
- Customers check availability, book, reschedule, cancel and list their bookings in chat.
- Services with duration and capacity ("3 at a time"), plus business hours and time zone.
- Optional Google Calendar sync (checks busy times, creates events).
- Reminders via an approved WhatsApp template, rebuilt from the database after a restart.

### Documents
- Upload menus, catalogs and price lists. The bot sends the right file when a customer asks.

### Message templates
- Create templates in the dashboard with a live WhatsApp preview. They're submitted to Meta, and the review status updates live.

### Dashboard (app.captus.cc)
- Overview with setup checklist and stats, inbox, conversation view, bookings, knowledge base, documents, templates, settings, and an admin page for adding businesses.

### Reliability and safety
- Multi-tenant with Postgres Row Level Security (one business can never see another's data).
- Checks Meta webhook signatures, ignores duplicate deliveries, filters echoes and group chats, and rate-limits each contact.
- Gemini fallback chain across 5 models, sorted by error type (rate limit, daily quota, overload, timeout, bad key, billing…). Customers get a holding reply instead of silence, and the operator gets alerts.
- E2E stress harness: 31 scenarios, failure injection, 50 chats arriving at once.

---

## Backlog

### Before real paying customers (must-do)
| Item | Why | Effort |
|---|---|---|
| Paid Gemini key | On the free tier, Google may use customer messages, and capacity is low (~30 chats at once). | S |
| Permanent WhatsApp system-user token | The current token expires around **31 Oct 2026**. | S |
| Redis with persistence (Render paid) | Free Redis loses queued replies and debounce timers on restart. | S |
| Vercel Pro | Hobby is non-commercial only. | S |
| Clerk production keys | Still on the dev instance. | S |
| Meta business verification | Needed for higher messaging limits and to onboard other businesses. | S (paperwork) |
| Real-phone smoke test of every flow | E2E uses a mock Meta, so nothing has been tested end to end on a real phone yet. | S |
| Rotate the Neon password, delete the old Ohio project | The password was shared in chat. | S |

### Onboarding
| Item | Notes | Effort |
|---|---|---|
| **Embedded Signup (Tech Provider)** | The business connects its own number in a few clicks, with no admin page and no copying IDs. Unlocks the two items below. | L |
| Coexistence (keep using the WhatsApp Business app on the same number) | Owners can still reply from their phone. Big selling point for small businesses. | M (after Embedded Signup) |
| **Learn from past chats** | The owner uploads WhatsApp chat exports, and the AI drafts the knowledge base (prices, common questions, tone) for the owner to approve. Needs the paid key and a consent checkbox, and raw files are deleted after processing. Later: Meta's history sync (up to 6 months) through coexistence. | M |
| Website import | Paste a URL, crawl the site, draft the knowledge base. | M |
| Self-serve sign-up + trial | Today businesses are added from the admin page. | M |

### Money
| Item | Notes | Effort |
|---|---|---|
| Subscription billing (Stripe / HitPay) | Plans, trial, usage limits per plan. | M |
| Invoices + payment links in chat | Prices come only from the price list, never made up by the AI. DuitNow / PayNow QR through HitPay or Billplz. | L |
| Booking deposits | Pay to confirm a slot, which cuts down no-shows. | M |
| WhatsApp catalog / product cards | Send products as native WhatsApp product messages. | M |

### Customer relationship
| Item | Notes | Effort |
|---|---|---|
| Customer profile + memory facts | Name, preferences, allergies, past bookings, shown in the chat sidebar and used by the AI. | M |
| Tags + notes on contacts | Auto-tag (lead, VIP, complaint), plus manual notes. | S–M |
| Contacts page with search/filter | Includes import/export as CSV. | M |
| Follow-up rules | E.g. a quote with no reply after 48h gets a nudge; after a booking, ask for a review. Uses templates. | M |
| Broadcasts / campaigns | Send a template to a tagged segment, with opt-out handling. | M |
| Abandoned-booking nudge | Customer checked slots but never booked. | S |

### Conversation quality
| Item | Notes | Effort |
|---|---|---|
| Interactive buttons and lists | Slot picking and yes/no confirmations as WhatsApp buttons instead of typed replies. | M |
| Template status webhook | Instant status updates instead of polling every 10s. | S |
| Media template headers | Image/PDF at the top of a template. | S |
| Suggested replies for the owner | When the owner takes over, the AI drafts a reply for them to edit and send. | S |
| "Teach the bot" from the inbox | Turn the owner's manual answer into a new FAQ in one click. | S |
| Unanswered-questions report | Lists questions the bot couldn't answer, so the owner can fill the gaps. | S |
| Hybrid search + reranking | Only for businesses with big catalogs, so it could be a per-plan setting. | M |

### Team and multi-location
| Item | Notes | Effort |
|---|---|---|
| Team members + roles | Several staff share one inbox, with chats assigned to a person. | M |
| Multiple numbers / branches per business | Bigger plans. | M |
| Staff-specific bookings | Book with a particular stylist or therapist, each with their own calendar. | M |

### Insight and operations
| Item | Notes | Effort |
|---|---|---|
| Analytics | Chats handled by the bot vs. a person, response time, bookings from chat, top topics. | M |
| Email / Telegram ops alerts | So operator alerts don't depend on WhatsApp itself working. | S |
| Error tracking (Sentry) + log search | | S |
| Usage dashboard for the operator | AI cost, messages and quota use per business. | M |
| Data export / deletion per business | PDPA requests. | S |

### Other channels (later)
- Instagram DM and Facebook Messenger use the same Meta app and webhook, so they're a natural next step. **L**
- A website chat widget. **M**
