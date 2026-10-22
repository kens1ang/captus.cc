import { execSync, spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { MockMeta } from "./mockMeta.js";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const OUT = path.join(ROOT, "e2e", ".out");
fs.mkdirSync(OUT, { recursive: true });

const APP_PORT = 3100;
const MOCK_PORT = 3199;
export const APP_SECRET = "e2e-app-secret";
export const OWNER_NUMBER = "60100000001";
export const TENANT_A_PHONE_ID = "e2e-phone-kopi";
export const TENANT_B_PHONE_ID = "e2e-phone-glow";

/** Read the real Gemini key from .env without loading anything else from it (local dev settings must not leak in). */
function geminiKeyFromDotenv(): string {
  const line = fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).find((l) => l.startsWith("GEMINI_API_KEY="));
  if (!line) throw new Error("GEMINI_API_KEY missing from .env");
  return line.slice("GEMINI_API_KEY=".length).trim();
}

/** Complete env for both the harness and the app — set explicitly so nothing falls through to .env. */
export const E2E_ENV: Record<string, string> = {
  PORT: String(APP_PORT),
  DATABASE_URL: "postgres://captus:captus@localhost:5433/captus",
  APP_DB_PASSWORD: "captus_app_e2e",
  APP_DATABASE_URL: "postgres://captus_app:captus_app_e2e@localhost:5433/captus",
  REDIS_URL: "redis://localhost:6380",
  WHATSAPP_ACCESS_TOKEN: "e2e-token",
  WHATSAPP_PHONE_NUMBER_ID: TENANT_A_PHONE_ID,
  WHATSAPP_VERIFY_TOKEN: "e2e-verify",
  WHATSAPP_APP_SECRET: APP_SECRET,
  WHATSAPP_GRAPH_BASE: `http://localhost:${MOCK_PORT}`,
  GEMINI_API_KEY: geminiKeyFromDotenv(),
  BUSINESS_NAME: "Kopi Corner",
  BUSINESS_DESCRIPTION: "A cosy kopitiam-style cafe in Bangsar, Kuala Lumpur.",
  OWNER_NOTIFY_NUMBER: OWNER_NUMBER,
  CLERK_SECRET_KEY: "sk_test_e2e_unused",
  DASHBOARD_ORIGIN: "http://localhost:3101",
  BACKEND_PUBLIC_URL: `http://localhost:${APP_PORT}`,
  TOKEN_ENCRYPTION_KEY: "0".repeat(64),
  GOOGLE_CLIENT_ID: "unused",
  GOOGLE_CLIENT_SECRET: "unused",
  GOOGLE_REDIRECT_URI: "http://localhost/unused",
  MESSAGE_DEBOUNCE_MS: "3000",
  // The website-import scenarios serve their fixture site on localhost.
  IMPORT_ALLOW_PRIVATE_HOSTS: "1",
};
Object.assign(process.env, E2E_ENV);

export const mock = new MockMeta(MOCK_PORT);
export const db = new pg.Pool({ connectionString: E2E_ENV.DATABASE_URL, max: 4 });
db.on("error", () => {}); // the outage scenarios kill its idle connections on purpose

// --- Infrastructure ---------------------------------------------------------

export function compose(args: string): void {
  execSync(`docker compose -f e2e/docker-compose.yml ${args}`, { cwd: ROOT, stdio: "pipe" });
}

export async function startInfra(): Promise<void> {
  compose("down -v --remove-orphans");
  compose("up -d");
  for (let i = 0; i < 60; i++) {
    try {
      await db.query("SELECT 1");
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error("e2e postgres never came up");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- The app under test -----------------------------------------------------

let app: ChildProcess | undefined;
let appLog: fs.WriteStream | undefined;
export let appPid: number | undefined;

function tsx(script: string, env: Record<string, string>): ChildProcess {
  return spawn(process.execPath, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), script], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export async function migrate(): Promise<void> {
  const p = tsx("src/db/migrate.ts", E2E_ENV);
  let out = "";
  p.stdout!.on("data", (d) => (out += d));
  p.stderr!.on("data", (d) => (out += d));
  const code = await new Promise<number>((r) => p.on("exit", (c) => r(c ?? 1)));
  if (code !== 0) throw new Error(`migrate failed:\n${out}`);
}

/** Starts src/main.ts (server + workers, exactly as on Render) with optional env overrides. */
export async function startApp(overrides: Record<string, string> = {}, logName = "app.log"): Promise<void> {
  appLog = fs.createWriteStream(path.join(OUT, logName), { flags: "a" });
  app = tsx("src/main.ts", { ...E2E_ENV, ...overrides });
  appPid = app.pid;
  app.stdout!.pipe(appLog);
  app.stderr!.pipe(appLog);
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${APP_PORT}/health`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error("app never became healthy — see e2e/.out/" + logName);
}

export async function stopApp(): Promise<void> {
  if (!app) return;
  const exited = new Promise((r) => app!.on("exit", r));
  app.kill();
  await Promise.race([exited, sleep(5000)]);
  app = undefined;
  appLog?.end();
}

export async function restartApp(overrides: Record<string, string> = {}, logName = "app.log"): Promise<void> {
  await stopApp();
  await startApp(overrides, logName);
}

export function appLogText(logName = "app.log"): string {
  return fs.readFileSync(path.join(OUT, logName), "utf8");
}

// --- Fake customers ---------------------------------------------------------

let msgSeq = 0;
export function newMessageId(): string {
  return `wamid.e2e.${Date.now()}.${++msgSeq}`;
}

type InboundMessage =
  | { type: "text"; text: string }
  | { type: "audio"; mediaId: string; mime: string }
  | { type: "image"; mediaId: string; mime: string; caption?: string }
  | { type: "document"; mediaId: string; mime: string; filename: string; caption?: string }
  | { type: "sticker" };

export function webhookBody(phoneNumberId: string, from: string, msg: InboundMessage, id = newMessageId()): string {
  const base = { id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: msg.type };
  const message =
    msg.type === "text"
      ? { ...base, text: { body: msg.text } }
      : msg.type === "audio"
        ? { ...base, audio: { id: msg.mediaId, mime_type: msg.mime } }
        : msg.type === "image"
          ? { ...base, image: { id: msg.mediaId, mime_type: msg.mime, caption: msg.caption } }
          : msg.type === "document"
            ? { ...base, document: { id: msg.mediaId, mime_type: msg.mime, filename: msg.filename, caption: msg.caption } }
            : { ...base, sticker: { id: "sticker1", mime_type: "image/webp" } };
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "e2e-waba",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: phoneNumberId, display_phone_number: "60300000000" },
              contacts: [{ wa_id: from, profile: { name: "E2E Customer" } }],
              messages: [message],
            },
          },
        ],
      },
    ],
  });
}

/** Meta's receipt for a message Captus sent: delivered / read / failed. */
export function statusBody(phoneNumberId: string, wamid: string, recipient: string, status: "delivered" | "read" | "failed", error?: { code: number; title: string }): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "e2e-waba",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: phoneNumberId, display_phone_number: "60300000000" },
              statuses: [{ id: wamid, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: recipient, ...(error && { errors: [error] }) }],
            },
          },
        ],
      },
    ],
  });
}

export function sign(body: string, secret = APP_SECRET): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export async function postWebhook(body: string, signature = sign(body)): Promise<number> {
  const r = await fetch(`http://localhost:${APP_PORT}/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hub-signature-256": signature },
    body,
  });
  return r.status;
}

/** A fake WhatsApp customer of one business. */
export class Customer {
  constructor(
    public phoneNumberId: string,
    public number: string,
  ) {}

  async send(msg: InboundMessage | string, id?: string): Promise<number> {
    const m: InboundMessage = typeof msg === "string" ? { type: "text", text: msg } : msg;
    return postWebhook(webhookBody(this.phoneNumberId, this.number, m, id));
  }

  /** Sends, then waits for the bot's next message(s). Returns the new ones. */
  async ask(msg: InboundMessage | string, timeoutMs = 120_000): Promise<string[]> {
    const before = mock.messagesTo(this.number).length;
    await this.send(msg);
    // Wait for a TEXT reply specifically: a document the bot sends mid-turn
    // (menu PDF) arrives before its text answer, which can be seconds later.
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !mock.messagesTo(this.number).slice(before).some((o) => o.type === "text")) await sleep(250);
    await sleep(1500); // let anything trailing land too
    return mock.messagesTo(this.number).slice(before).map((o) => o.text ?? (o.document ? `[document: ${o.document.filename}]` : `[${o.type}]`));
  }

  replies(): string[] {
    return mock.messagesTo(this.number).map((o) => o.text ?? `[${o.type}]`);
  }
}

let numberSeq = 0;
export function newCustomer(phoneNumberId = TENANT_A_PHONE_ID): Customer {
  return new Customer(phoneNumberId, `6012${String(Date.now()).slice(-5)}${String(++numberSeq).padStart(3, "0")}`);
}

// --- DB helpers (owner connection: superuser, sees every tenant) ------------

export async function conversationOf(phoneNumberId: string, contact: string) {
  const r = await db.query(
    `SELECT c.* FROM conversations c JOIN tenants t ON t.id = c.tenant_id
     WHERE t.whatsapp_phone_number_id = $1 AND c.wa_number = $2`,
    [phoneNumberId, contact],
  );
  return r.rows[0] as { id: string; status: string; summary: string | null } | undefined;
}

export async function messagesOf(phoneNumberId: string, contact: string) {
  const r = await db.query(
    `SELECT m.direction, m.content, m.wa_message_id FROM messages m
     JOIN conversations c ON c.id = m.conversation_id JOIN tenants t ON t.id = c.tenant_id
     WHERE t.whatsapp_phone_number_id = $1 AND c.wa_number = $2 ORDER BY m.created_at`,
    [phoneNumberId, contact],
  );
  return r.rows as { direction: "in" | "out"; content: string; wa_message_id: string | null }[];
}

export async function bookingsOf(contact: string) {
  const r = await db.query(
    `SELECT b.id, b.status, b.starts_at, b.ends_at, s.name AS service FROM bookings b
     LEFT JOIN services s ON s.id = b.service_id WHERE b.contact_wa_number = $1 ORDER BY b.created_at`,
    [contact],
  );
  return r.rows as { id: string; status: string; starts_at: Date; ends_at: Date; service: string }[];
}
