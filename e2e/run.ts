// End-to-end + stress harness. Real backend, real worker, real Postgres/Redis
// (throwaway Docker stack), real Gemini; only Meta's WhatsApp API is mocked.
//
//   npm run e2e                      # everything
//   npm run e2e -- scenarios         # just the feature scenarios
//   npm run e2e -- failures load     # pick phases
//
// Writes e2e/.out/report.md (+ app logs). Uses the GEMINI_API_KEY from .env.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DateTime } from "luxon";
import {
  OUT,
  ROOT,
  OWNER_NUMBER,
  TENANT_A_PHONE_ID,
  TENANT_B_PHONE_ID,
  E2E_ENV,
  mock,
  db,
  compose,
  startInfra,
  migrate,
  startApp,
  stopApp,
  restartApp,
  appLogText,
  appPid,
  sleep,
  newCustomer,
  newMessageId,
  webhookBody,
  postWebhook,
  sign,
  conversationOf,
  messagesOf,
  bookingsOf,
  type Customer,
} from "./harness.js";
import { seed, type Seeded } from "./seed.js";

const TZ = "Asia/Kuala_Lumpur";
const HOLDING = /trouble replying right now/i;

interface Result {
  phase: string;
  name: string;
  pass: boolean;
  detail: string;
  ms: number;
  transcript: string[];
}
const results: Result[] = [];
let current: Result | undefined;

function note(line: string) {
  current?.transcript.push(line);
}

async function scenario(phase: string, name: string, fn: () => Promise<string | void>) {
  const only = process.env.E2E_ONLY;
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  current = { phase, name, pass: false, detail: "", ms: 0, transcript: [] };
  const t0 = Date.now();
  process.stdout.write(`  ${name} … `);
  try {
    current.detail = (await fn()) ?? "";
    current.pass = true;
  } catch (err) {
    current.detail = err instanceof Error ? err.message : String(err);
  }
  current.ms = Date.now() - t0;
  console.log(`${current.pass ? "PASS" : "FAIL"} (${(current.ms / 1000).toFixed(1)}s)${current.pass ? "" : ` — ${current.detail}`}`);
  results.push(current);
}

function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** ask() + record both sides in the transcript. */
async function chat(c: Customer, text: string, timeoutMs?: number): Promise<string> {
  note(`> ${text}`);
  const replies = await c.ask(text, timeoutMs);
  for (const r of replies) note(`< ${r}`);
  expect(replies.length > 0, `no reply to "${text}"`);
  return replies.join("\n");
}

function day(offset: number) {
  return DateTime.now().setZone(TZ).plus({ days: offset }).startOf("day");
}
const spoken = (d: DateTime) => d.toFormat("cccc d LLLL"); // "Saturday 18 October"

async function insertBooking(s: Seeded, serviceId: string, contact: string, start: DateTime, minutes: number) {
  await db.query(
    `INSERT INTO bookings (tenant_id, service_id, contact_wa_number, contact_name, starts_at, ends_at, status)
     VALUES ($1, $2, $3, 'Seeded', $4, $5, 'confirmed')`,
    [s.tenantA, serviceId, contact, start.toISO(), start.plus({ minutes }).toISO()],
  );
}

const atLocal = (b: { starts_at: Date }) => DateTime.fromJSDate(b.starts_at).setZone(TZ);

/** Booking conversations sometimes need a "yes, confirm" — nudge up to twice. */
async function bookUntil(c: Customer, first: string, done: () => Promise<boolean>): Promise<void> {
  await chat(c, first);
  for (let i = 0; i < 2 && !(await done()); i++) await chat(c, "Yes please, go ahead and confirm it. My name is Ali.");
}

// ---------------------------------------------------------------------------

async function featureScenarios(s: Seeded) {
  console.log("\n# Feature scenarios");
  const P = "Feature";

  await scenario(P, "Webhook verification handshake", async () => {
    const r = await fetch(`http://localhost:3100/webhook?hub.mode=subscribe&hub.verify_token=e2e-verify&hub.challenge=4242`);
    expect((await r.text()) === "4242", "challenge not echoed");
    const bad = await fetch(`http://localhost:3100/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`);
    expect(bad.status === 403, `wrong token got ${bad.status}`);
  });

  await scenario(P, "Rejects unsigned / forged webhooks", async () => {
    const c = newCustomer();
    const body = webhookBody(TENANT_A_PHONE_ID, c.number, { type: "text", text: "hello" });
    expect((await postWebhook(body, "sha256=" + "0".repeat(64))) === 401, "forged signature accepted");
    expect((await postWebhook(body, "")) === 401, "missing signature accepted");
    await sleep(6000);
    expect(c.replies().length === 0, "forged message got a reply");
    expect(!(await conversationOf(TENANT_A_PHONE_ID, c.number)), "forged message was stored");
  });

  await scenario(P, "Answers opening hours (always-on info)", async () => {
    const r = await chat(newCustomer(), "Hi! What time do you close on Saturday?");
    expect(/10|22/.test(r), "closing time (10pm) not in reply");
  });

  await scenario(P, "Answers a price from the product list", async () => {
    const r = await chat(newCustomer(), "How much is a latte?");
    expect(/9[.,]50/.test(r), "RM 9.50 not in reply");
  });

  await scenario(P, "Answers from FAQ (retrieval)", async () => {
    const r = await chat(newCustomer(), "do u have wifi? whats the password");
    expect(/kopi2026/i.test(r), "wifi password not in reply");
  });

  await scenario(P, "Doesn't invent things it wasn't told", async () => {
    const r = await chat(newCustomer(), "Do you sell motorcycle spare parts? How much for a brake pad?");
    expect(!/RM\s?\d/.test(r) || /not|don't|do not|sorry/i.test(r), "quoted a price for something not sold");
    expect(!/\byes,? we (do|sell)/i.test(r), "claimed to sell motorcycle parts");
  });

  await scenario(P, "Replies in Malay", async () => {
    const r = await chat(newCustomer(), "Kedai buka pukul berapa hari Ahad?");
    expect(/\b(kami|buka|pukul|pagi|malam|hari)\b/i.test(r), "reply doesn't look Malay");
    expect(/8|lapan/i.test(r), "opening time not in reply");
  });

  await scenario(P, "Replies in Chinese", async () => {
    const r = await chat(newCustomer(), "你们几点关门？有停车位吗？");
    expect(/[一-鿿]/.test(r), "reply has no Chinese characters");
  });

  await scenario(P, "Burst of 3 messages gets ONE combined reply", async () => {
    const c = newCustomer();
    for (const t of ["hi", "quick question", "is there parking nearby?"]) {
      note(`> ${t}`);
      await c.send(t);
      await sleep(700);
    }
    const got = await mock.waitFor(c.number, 1, 90_000);
    await sleep(8000); // would a second reply show up?
    for (const r of c.replies()) note(`< ${r}`);
    expect(got.length >= 1, "no reply");
    expect(c.replies().length === 1, `${c.replies().length} replies instead of 1`);
    expect(/parking|Telawi|Bangsar Village/i.test(c.replies()[0]), "combined reply didn't address the parking question");
  });

  await scenario(P, "Duplicate webhook delivery → one reply, one stored message", async () => {
    const c = newCustomer();
    const id = newMessageId();
    await Promise.all([c.send("What's your address?", id), c.send("What's your address?", id), c.send("What's your address?", id)]);
    await mock.waitFor(c.number, 1, 90_000);
    await sleep(8000);
    const inbound = (await messagesOf(TENANT_A_PHONE_ID, c.number)).filter((m) => m.direction === "in");
    expect(inbound.length === 1, `${inbound.length} inbound rows stored`);
    expect(c.replies().length === 1, `${c.replies().length} replies sent`);
  });

  await scenario(P, "Per-contact rate limit stops a message flood", async () => {
    const c = newCustomer();
    for (let i = 0; i < 14; i++) await c.send(`spam ${i}`);
    await sleep(15_000);
    const inbound = (await messagesOf(TENANT_A_PHONE_ID, c.number)).filter((m) => m.direction === "in");
    note(`stored ${inbound.length}/14 inbound, sent ${c.replies().length} replies`);
    expect(inbound.length <= 10, `${inbound.length} of 14 flood messages processed (limit 10/min)`);
    expect(c.replies().length <= 2, `${c.replies().length} replies to a flood`);
    return `${inbound.length}/14 processed, ${c.replies().length} reply`;
  });

  await scenario(P, "Typing indicator is sent before replying", async () => {
    const before = mock.outbound.filter((o) => o.type === "typing").length;
    await chat(newCustomer(), "Are pets allowed?");
    expect(mock.outbound.filter((o) => o.type === "typing").length > before, "no typing indicator");
  });

  await scenario(P, "Sends the menu PDF on request (and the link works)", async () => {
    const c = newCustomer();
    await chat(c, "Can you send me your menu please?");
    const doc = mock.messagesTo(c.number).find((o) => o.type === "document");
    expect(doc?.document, "no document message sent");
    const file = await fetch(doc.document.link);
    const bytes = Buffer.from(await file.arrayBuffer());
    expect(file.ok && bytes.subarray(0, 5).toString() === "%PDF-", `document link returned ${file.status}`);
  });

  await scenario(P, "Complaint escalates to a human + pings owner", async () => {
    const c = newCustomer();
    const before = mock.messagesTo(OWNER_NUMBER).length;
    await chat(c, "This is unacceptable. I found a hair in my nasi lemak and the staff was rude. I want to speak to the manager and get a refund NOW.");
    await sleep(2000);
    const convo = await conversationOf(TENANT_A_PHONE_ID, c.number);
    expect(convo?.status === "needs_human", `status is ${convo?.status}`);
    const pings = mock.messagesTo(OWNER_NUMBER).slice(before);
    expect(pings.some((p) => p.text?.includes(c.number)), "owner wasn't notified");
    // Once escalated, the bot must stay quiet.
    note("> hello??");
    await c.send("hello?? anyone there");
    await sleep(10_000);
    expect(c.replies().length === 1, "bot kept replying after escalation");
  });

  await scenario(P, "[behaviour] After an 'I don't know' escalation, follow-up questions", async () => {
    const c = newCustomer();
    await chat(c, "Do you sell durian cake? How much?");
    const status = (await conversationOf(TENANT_A_PHONE_ID, c.number))?.status;
    note(`[status after reply: ${status}]`);
    await c.send("ok never mind. what's your wifi password?");
    await sleep(15_000);
    const answered = c.replies().length > 1;
    note(answered ? `< ${c.replies()[1]}` : "[no reply — bot muted]");
    return status === "needs_human" ? (answered ? "escalated, still answers follow-ups" : "escalated → bot muted, follow-up ignored") : "not escalated, kept answering";
  });

  await scenario(P, "Human takeover silences the bot; resuming brings it back", async () => {
    const c = newCustomer();
    await chat(c, "hi, are you open now?");
    const convo = await conversationOf(TENANT_A_PHONE_ID, c.number);
    await db.query(`UPDATE conversations SET status = 'human_active' WHERE id = $1`, [convo!.id]);
    note("[owner takes over in dashboard]");
    await c.send("ok thanks, and do you have oat milk?");
    await sleep(10_000);
    expect(c.replies().length === 1, "bot replied while a human had taken over");
    await db.query(`UPDATE conversations SET status = 'bot' WHERE id = $1`, [convo!.id]);
    note("[owner hands back to the assistant]");
    const r = await chat(c, "Do you have oat milk?");
    expect(/oat/i.test(r), "bot didn't answer after being resumed");
  });

  // --- Bookings ---
  const tomorrow = day(1);
  await scenario(P, "Books a table (tomorrow 3pm)", async () => {
    const c = newCustomer();
    await bookUntil(c, `Hi, can I book a table for tomorrow (${spoken(tomorrow)}) at 3pm? Name is Ali.`, async () => (await bookingsOf(c.number)).length > 0);
    const bs = (await bookingsOf(c.number)).filter((b) => b.status === "confirmed");
    expect(bs.length === 1, `${bs.length} confirmed bookings`);
    const at = atLocal(bs[0]);
    expect(at.hasSame(tomorrow, "day") && at.hour === 15, `booked ${at.toISO()} instead of tomorrow 15:00`);
    expect(bs[0].service === "Table reservation", `booked "${bs[0].service}"`);
  });

  await scenario(P, "Capacity: 2nd booking in a slot with room is accepted", async () => {
    const d = day(2).set({ hour: 17 });
    await insertBooking(s, s.tableServiceId, "60199990001", d, 60);
    const c = newCustomer();
    await bookUntil(c, `Can I book a table on ${spoken(d)} at 5pm? I'm Ali.`, async () => (await bookingsOf(c.number)).length > 0);
    const bs = (await bookingsOf(c.number)).filter((b) => b.status === "confirmed");
    expect(bs.length === 1 && atLocal(bs[0]).hour === 17, `expected a 5pm booking, got ${bs.map((b) => atLocal(b).toFormat("HH:mm")).join(",") || "none"}`);
  });

  await scenario(P, "Capacity: full slot is refused, alternatives offered", async () => {
    const d = day(2).set({ hour: 15 });
    await insertBooking(s, s.tableServiceId, "60199990002", d, 60);
    await insertBooking(s, s.tableServiceId, "60199990003", d, 60);
    const c = newCustomer();
    const r = await chat(c, `Can I book a table on ${spoken(d)} at 3pm please? Name is Ali.`);
    const bs = (await bookingsOf(c.number)).filter((b) => b.status === "confirmed" && atLocal(b).hour === 15 && atLocal(b).hasSame(d, "day"));
    expect(bs.length === 0, "booked a slot that was already at capacity");
    expect(/not available|fully booked|unavailable|no longer|isn't available|is full|taken|other time|instead|alternative|\d(:\d\d)?\s?(am|pm)/i.test(r), "didn't say it's unavailable or offer other times");
  });

  await scenario(P, "Two customers, one private room (capacity 1) → no double booking", async () => {
    const d = day(5).set({ hour: 14 });
    const first = newCustomer();
    await bookUntil(first, `I'd like to book the private room on ${spoken(d)} at 2pm. Name Ali.`, async () => (await bookingsOf(first.number)).length > 0);
    const got = (await bookingsOf(first.number)).filter((b) => b.status === "confirmed" && b.service === "Private room");
    expect(got.length === 1 && atLocal(got[0]).hour === 14, "first customer didn't get the 2pm room");
    const second = newCustomer();
    await chat(second, `Can I book the private room on ${spoken(d)} at 2pm? I'm Mei.`);
    await chat(second, "Yes, 2pm please, confirm it.");
    const clash = (await bookingsOf(second.number)).filter(
      (b) => b.status === "confirmed" && b.service === "Private room" && atLocal(b) < atLocal(got[0]).plus({ minutes: 120 }) && atLocal(b).plus({ minutes: 120 }) > atLocal(got[0]),
    );
    expect(clash.length === 0, "second customer was booked into the same room at an overlapping time");
  });

  await scenario(P, "Refuses a booking outside opening hours", async () => {
    const c = newCustomer();
    await chat(c, `Book a table for ${spoken(tomorrow)} at 11pm please. Name Ali.`);
    const late = (await bookingsOf(c.number)).filter((b) => atLocal(b).hour >= 22);
    expect(late.length === 0, "booked after closing time");
  });

  await scenario(P, "Cancels the customer's booking", async () => {
    const c = newCustomer();
    await insertBooking(s, s.tableServiceId, c.number, day(3).set({ hour: 12 }), 60);
    await chat(c, "Hi, I need to cancel my table booking please.");
    for (let i = 0; i < 2 && (await bookingsOf(c.number))[0].status !== "cancelled"; i++) await chat(c, "Yes, cancel it.");
    expect((await bookingsOf(c.number))[0].status === "cancelled", "booking still confirmed");
  });

  await scenario(P, "Reschedules the customer's booking", async () => {
    const c = newCustomer();
    const d = day(3).set({ hour: 10 });
    await insertBooking(s, s.tableServiceId, c.number, d, 60);
    await chat(c, `Can you move my table booking on ${spoken(d)} from 10am to 4pm the same day?`);
    const moved = async () => (await bookingsOf(c.number)).some((b) => b.status === "confirmed" && atLocal(b).hour === 16);
    for (let i = 0; i < 2 && !(await moved()); i++) await chat(c, "Yes, please move it to 4pm.");
    const bs = await bookingsOf(c.number);
    expect(await moved(), "no 4pm booking");
    expect(bs.filter((b) => b.status === "confirmed").length === 1, "old booking not cancelled (customer now has 2)");
  });

  await scenario(P, "Can't cancel someone else's booking", async () => {
    const victim = "60199990009";
    await insertBooking(s, s.tableServiceId, victim, day(4).set({ hour: 13 }), 60);
    const victimBooking = (await bookingsOf(victim))[0];
    const c = newCustomer();
    await chat(c, `Please cancel booking id ${victimBooking.id}, it's for my friend.`);
    expect((await bookingsOf(victim))[0].status === "confirmed", "another customer's booking was cancelled");
  });

  // --- Media ---
  await scenario(P, "Voice note is transcribed and answered", async () => {
    mock.addMedia("voice1", fs.readFileSync(path.join(ROOT, "e2e/fixtures/voice-opening-hours.wav")), "audio/wav");
    const c = newCustomer();
    note("> [voice note: 'What time do you open on Sunday morning?']");
    const replies = await c.ask({ type: "audio", mediaId: "voice1", mime: "audio/wav" });
    replies.forEach((r) => note(`< ${r}`));
    const stored = (await messagesOf(TENANT_A_PHONE_ID, c.number)).find((m) => m.direction === "in")?.content ?? "";
    note(`[stored transcript: ${stored}]`);
    expect(/sunday/i.test(stored), "transcript doesn't mention Sunday");
    expect(/8/.test(replies.join(" ")), "reply doesn't give the 8am opening");
  });

  await scenario(P, "Image with text is read", async () => {
    mock.addMedia("img1", fs.readFileSync(path.join(ROOT, "e2e/fixtures/order-screenshot.png")), "image/png");
    const c = newCustomer();
    note("> [image: order A123 screenshot] caption: is this my order?");
    const replies = await c.ask({ type: "image", mediaId: "img1", mime: "image/png", caption: "is this my order? when will it be ready" });
    replies.forEach((r) => note(`< ${r}`));
    const stored = (await messagesOf(TENANT_A_PHONE_ID, c.number)).find((m) => m.direction === "in")?.content ?? "";
    expect(/A123/i.test(stored), "image text (A123) not extracted");
  });

  await scenario(P, "PDF document is read", async () => {
    mock.addMedia("pdf1", fs.readFileSync(path.join(ROOT, "e2e/fixtures/receipt.pdf")), "application/pdf");
    const c = newCustomer();
    note("> [PDF receipt R-7781, total RM 24.00]");
    const replies = await c.ask({ type: "document", mediaId: "pdf1", mime: "application/pdf", filename: "receipt.pdf" });
    replies.forEach((r) => note(`< ${r}`));
    const stored = (await messagesOf(TENANT_A_PHONE_ID, c.number)).find((m) => m.direction === "in")?.content ?? "";
    expect(/24/.test(stored) && /R-?7781/i.test(stored), "receipt details not extracted");
  });

  await scenario(P, "Unsupported message (sticker) is acknowledged + escalated", async () => {
    const c = newCustomer();
    const before = mock.messagesTo(OWNER_NUMBER).length;
    const replies = await c.ask({ type: "sticker" }, 30_000);
    replies.forEach((r) => note(`< ${r}`));
    expect(replies.length === 1, "no acknowledgement");
    expect(mock.messagesTo(OWNER_NUMBER).length > before, "owner not notified");
  });

  await scenario(P, "Media that can't be downloaded → apology + escalation, not silence", async () => {
    const c = newCustomer();
    const replies = await c.ask({ type: "audio", mediaId: "does-not-exist", mime: "audio/ogg" }, 30_000);
    replies.forEach((r) => note(`< ${r}`));
    expect(replies.length === 1, "customer got no reply");
  });

  // --- Memory ---
  await scenario(P, "Remembers a fact from beyond the recent-message window", async () => {
    const c = newCustomer();
    await chat(c, "Hi! I'm Siti. Important: I'm severely allergic to peanuts.");
    const convo = await conversationOf(TENANT_A_PHONE_ID, c.number);
    // The allergy exchange happened "2 hours ago"; the filler comes after it.
    await db.query(`UPDATE messages SET created_at = now() - interval '2 hours' WHERE conversation_id = $1`, [convo!.id]);
    // 28 filler turns pushed in directly — cheaper than 28 real exchanges, same effect on history.
    for (let i = 0; i < 14; i++) {
      await db.query(`INSERT INTO messages (tenant_id, conversation_id, direction, content, created_at) VALUES ($1,$2,'in',$3, now() - interval '1 hour' + ($4 || ' seconds')::interval)`, [s.tenantA, convo!.id, `filler question ${i} about the weather`, i * 2]);
      await db.query(`INSERT INTO messages (tenant_id, conversation_id, direction, content, created_at) VALUES ($1,$2,'out',$3, now() - interval '1 hour' + ($4 || ' seconds')::interval)`, [s.tenantA, convo!.id, `filler answer ${i}: sorry, I can only help with the cafe`, i * 2 + 1]);
    }
    note("[28 filler messages inserted]");
    await chat(c, "What do you recommend for lunch?"); // triggers the summary update afterwards
    await sleep(5000);
    const summary = (await conversationOf(TENANT_A_PHONE_ID, c.number))?.summary ?? "";
    note(`[summary: ${summary}]`);
    expect(/peanut/i.test(summary), "long-term summary missed the peanut allergy");
    const r = await chat(c, "Remind me — do I have any allergies you know of?");
    expect(/peanut/i.test(r), "forgot the peanut allergy");
  });

  // --- Isolation ---
  await scenario(P, "Business B never sees business A's data", async () => {
    const r = await chat(newCustomer(TENANT_B_PHONE_ID), "What's the wifi password? And how much is a latte?");
    expect(!/kopi2026/i.test(r), "leaked Kopi Corner's wifi password");
    expect(!/9[.,]50/.test(r), "quoted Kopi Corner's latte price");
    const r2 = await chat(newCustomer(TENANT_B_PHONE_ID), "Is there parking?");
    expect(/basement|B1|free/i.test(r2), "didn't use Glow Salon's own parking FAQ");
    expect(!/Telawi|Bangsar/i.test(r2), "gave Kopi Corner's parking info");
  });
}

// ---------------------------------------------------------------------------

async function failureScenarios() {
  console.log("\n# Failure injection");
  const P = "Failure";

  await scenario(P, "Retired model first in chain → falls back, customer unaffected", async () => {
    await restartApp({ GEMINI_MODELS: "gemini-2.5-flash,gemini-3.5-flash-lite" }, "app-fallback.log");
    const r = await chat(newCustomer(), "What time do you open?");
    expect(/8/.test(r), "no proper answer");
    expect(/answered by fallback model gemini-3.5-flash-lite/.test(appLogText("app-fallback.log")), "fallback not logged");
  });

  await scenario(P, "Every model gone → holding reply, needs_human, owner + ops alerted", async () => {
    await restartApp({ GEMINI_MODELS: "gemini-2.5-flash,gemini-2.5-flash-lite" }, "app-allfail.log");
    const c = newCustomer();
    const before = mock.messagesTo(OWNER_NUMBER).length;
    const r = await chat(c, "Do you have vegetarian options?", 90_000);
    expect(HOLDING.test(r), "no holding reply");
    expect((await conversationOf(TENANT_A_PHONE_ID, c.number))?.status === "needs_human", "not handed to a human");
    const owner = mock.messagesTo(OWNER_NUMBER).slice(before).map((m) => m.text ?? "");
    expect(owner.some((t) => t.includes(c.number)), "business owner not told");
    expect(owner.some((t) => /ops alert/i.test(t)), "operator not alerted");
    expect(/\[OPS ALERT\] allfailed:reply/.test(appLogText("app-allfail.log")), "no OPS ALERT log line");
  });

  await scenario(P, "Slow model (times out every time) → retried, then holding reply", async () => {
    await restartApp({ GEMINI_MODELS: "gemini-3.8-flash" }, "app-timeout.log");
    const c = newCustomer();
    const t0 = Date.now();
    const r = await chat(c, "What's your address?", 240_000);
    const secs = Math.round((Date.now() - t0) / 1000);
    note(`[customer waited ${secs}s]`);
    // Either a real answer (3.8 happened to be fast) or the holding reply — never silence.
    expect(HOLDING.test(r) || /Telawi|Bangsar/i.test(r), "neither an answer nor the holding reply");
    return `customer waited ${secs}s — ${HOLDING.test(r) ? "holding reply" : "real answer"}`;
  });

  await scenario(P, "Invalid Gemini key → holding reply + auth ops alert", async () => {
    await restartApp({ GEMINI_API_KEY: "AIzaSyInvalid000000000000000000000000000" }, "app-badkey.log");
    const r = await chat(newCustomer(), "Hi, are you open today?", 90_000);
    expect(HOLDING.test(r), "no holding reply");
    expect(/\[OPS ALERT\] auth/.test(appLogText("app-badkey.log")), "no auth ops alert");
  });

  await restartApp({}, "app-failures.log");

  await scenario(P, "WhatsApp send fails twice, then works → exactly one reply delivered", async () => {
    const c = newCustomer();
    mock.failSendsTo(c.number, 2);
    const r = await chat(c, "How much is teh tarik?", 120_000);
    await sleep(8000);
    expect(c.replies().length === 1, `${c.replies().length} replies delivered`);
    const outRows = (await messagesOf(TENANT_A_PHONE_ID, c.number)).filter((m) => m.direction === "out");
    expect(outRows.length === 1, `${outRows.length} outbound rows stored`);
    expect(/4[.,]50/.test(r), "wrong answer");
  });

  await scenario(P, "WhatsApp send keeps failing → no duplicate/phantom messages", async () => {
    const c = newCustomer();
    mock.failSendsTo(c.number, 99);
    await c.send("Is the food halal?");
    await sleep(45_000);
    const outRows = (await messagesOf(TENANT_A_PHONE_ID, c.number)).filter((m) => m.direction === "out");
    const convo = await conversationOf(TENANT_A_PHONE_ID, c.number);
    note(`[delivered: 0, stored outbound: ${outRows.length}, status: ${convo?.status}]`);
    expect(outRows.length === 0, "a reply that never reached the customer was recorded as sent");
    return `customer got nothing; conversation status "${convo?.status}" — nobody is told`;
  });

  await scenario(P, "Redis restarts while a reply is pending", async () => {
    const c = newCustomer();
    await c.send("What's on the menu for breakfast?");
    await sleep(500);
    compose("restart redis");
    note("[redis restarted ~0.5s after the message]");
    const got = await mock.waitFor(c.number, 1, 60_000);
    const stored = (await messagesOf(TENANT_A_PHONE_ID, c.number)).filter((m) => m.direction === "in").length;
    note(`[inbound stored: ${stored}, replies: ${got.length}]`);
    expect(got.length === 1, `message ${stored ? "was stored but" : "was"} never answered (lost with Redis)`);
  });

  await restartApp({}, "app-failures2.log");

  await scenario(P, "Postgres down for 10s while a message arrives", async () => {
    const c = newCustomer();
    compose("stop postgres");
    note("[postgres stopped]");
    const status = await c.send("Do you take DuitNow?");
    note(`[webhook answered ${status}]`);
    await sleep(10_000);
    compose("start postgres");
    note("[postgres started]");
    const got = await mock.waitFor(c.number, 1, 90_000);
    for (const r of c.replies()) note(`< ${r}`);
    expect(got.length === 1, "message lost — never answered after the DB came back");
  });
}

// ---------------------------------------------------------------------------

interface LoadRow {
  n: number;
  answered: number;
  holding: number;
  silent: number;
  p50: number;
  p95: number;
  max: number;
  rssMb: number;
}
const loadRows: LoadRow[] = [];

function appRssMb(): number {
  try {
    // tsx runs the app in a child of the pid we spawned — sum the tree.
    const out = execSync(
      `powershell -NoProfile -Command "$p=${appPid}; $ids=@($p)+(Get-CimInstance Win32_Process -Filter \\"ParentProcessId=$p\\").ProcessId; (Get-Process -Id $ids | Measure-Object WorkingSet64 -Sum).Sum"`,
    ).toString();
    return Math.round(Number(out.trim()) / 1024 / 1024);
  } catch {
    return -1;
  }
}

async function loadTest(levels: number[]) {
  console.log("\n# Load");
  await restartApp({}, "app-load.log");
  const questions = ["What time do you close?", "How much is nasi lemak?", "Is there parking?", "Do you have wifi?", "Can I bring my dog?", "Do you deliver?"];
  for (const n of levels) {
    await scenario("Load", `${n} customers message at the same moment`, async () => {
      const customers = Array.from({ length: n }, () => newCustomer());
      const t0 = Date.now();
      let peakRss = 0;
      const sampler = setInterval(() => (peakRss = Math.max(peakRss, appRssMb())), 3000);
      await Promise.all(customers.map((c, i) => c.send(questions[i % questions.length])));
      const times: number[] = [];
      await Promise.all(
        customers.map(async (c) => {
          const got = await mock.waitFor(c.number, 1, 240_000);
          if (got.length) times.push(got[0].at - t0);
        }),
      );
      clearInterval(sampler);
      const texts = customers.map((c) => c.replies()[0] ?? "");
      const holding = texts.filter((t) => HOLDING.test(t)).length;
      const silent = texts.filter((t) => !t).length;
      times.sort((a, b) => a - b);
      const pct = (p: number) => (times.length ? Math.round(times[Math.min(times.length - 1, Math.floor(p * times.length))] / 1000) : -1);
      const row = { n, answered: n - holding - silent, holding, silent, p50: pct(0.5), p95: pct(0.95), max: pct(1), rssMb: peakRss };
      loadRows.push(row);
      expect(silent === 0, `${silent}/${n} customers got no reply at all`);
      return `${row.answered} answered, ${holding} holding, p50 ${row.p50}s, p95 ${row.p95}s, peak RAM ${peakRss}MB`;
    });
    await sleep(65_000); // let per-minute Gemini quotas recover between levels
  }
  const log = appLogText("app-load.log");
  const count = (re: RegExp) => (log.match(re) ?? []).length;
  return {
    rateLimited: count(/\(rate_limited\)/g),
    quota: count(/\(quota_exhausted\)/g),
    overloaded: count(/\(overloaded\)/g),
    timeouts: count(/\(timeout\)/g),
    fallbacks: count(/answered by fallback model/g),
  };
}

// ---------------------------------------------------------------------------

function writeReport(loadStats?: Record<string, number>) {
  const pass = results.filter((r) => r.pass).length;
  const lines: string[] = [
    `# Captus end-to-end report`,
    ``,
    `Run ${new Date().toISOString()} · ${pass}/${results.length} passed · models: ${E2E_ENV.GEMINI_MODELS ?? "default chain"}`,
    ``,
    `| | Phase | Scenario | Time | Notes |`,
    `|---|---|---|---|---|`,
    ...results.map((r) => `| ${r.pass ? "✅" : "❌"} | ${r.phase} | ${r.name} | ${(r.ms / 1000).toFixed(1)}s | ${r.detail.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`),
  ];
  if (loadRows.length) {
    lines.push(``, `## Load`, ``, `| Customers | Answered | Holding reply | No reply | p50 | p95 | Slowest | Peak RAM |`, `|---|---|---|---|---|---|---|---|`);
    for (const r of loadRows) lines.push(`| ${r.n} | ${r.answered} | ${r.holding} | ${r.silent} | ${r.p50}s | ${r.p95}s | ${r.max}s | ${r.rssMb}MB |`);
    if (loadStats) lines.push(``, `Gemini during load: ${Object.entries(loadStats).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  }
  lines.push(``, `## Transcripts`);
  for (const r of results.filter((x) => x.transcript.length)) {
    lines.push(``, `### ${r.pass ? "✅" : "❌"} ${r.name}`, "```", ...r.transcript, "```");
  }
  fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n"));
  console.log(`\n${pass}/${results.length} passed — report: e2e/.out/report.md`);
}

async function main() {
  const args = process.argv.slice(2);
  const phases = args.length ? args : ["scenarios", "failures", "load"];
  for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f));

  console.log("Starting throwaway Postgres + Redis, mock WhatsApp, migrating, seeding…");
  await mock.start();
  await startInfra();
  await migrate();
  const seeded = await seed();
  await startApp();

  let loadStats: Record<string, number> | undefined;
  try {
    if (phases.includes("scenarios")) await featureScenarios(seeded);
    if (phases.includes("failures")) await failureScenarios();
    if (phases.includes("load")) loadStats = await loadTest((process.env.E2E_LOAD_LEVELS ?? "10,25,50").split(",").map(Number));
  } finally {
    writeReport(loadStats);
    await stopApp();
    await mock.stop();
    await db.end();
    if (!process.env.E2E_KEEP_INFRA) compose("down -v");
  }
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
