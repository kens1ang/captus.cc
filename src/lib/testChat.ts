import { withTenant } from "../db/tenantContext.js";
import { getTenantById } from "../db/tenants.js";
import { connection } from "./queue.js";
import { runReplyTurn, type ChatTurn, type LoggedToolCall, type ToolCall } from "./gemini.js";
import { loadBusinessContext, buildReplySystemPrompt } from "./replyContext.js";
import { buildBookingTools, executeBookingTool, BOOKING_TOOL_NAMES, type SandboxBooking } from "./bookingTools.js";
import { buildDocumentTools, executeDocumentTool, documentLink, DOCUMENT_TOOL_NAMES } from "./documentTools.js";

// Dashboard test chat (Knowledge tab; API in routes/testChat.ts): the owner
// chats with their own assistant before — or without — a WhatsApp number.
// Same prompt, same knowledge, same tools as a real WhatsApp reply
// (lib/replyContext.ts), but nothing leaves the chat: bookings go into a
// per-user sandbox list in Redis (no bookings row, Google event or
// reminder), documents aren't sent, and a handover is only reported, not
// raised. The browser holds the transcript and sends it back each turn, so
// nothing here is stored in the inbox.

const MAX_TURNS = 40;
const MAX_TEXT = 2000;
// Each test message is a real Gemini call against the same quota as
// customer replies — keep a busy owner from starving their own customers.
const MAX_PER_HOUR = 60;
const SANDBOX_TTL_SECONDS = 6 * 3600;

const sandboxKey = (tenantId: string, userId: string) => `testchat:bookings:${tenantId}:${userId}`;

export interface TestChatAction {
  kind: "availability" | "booking" | "cancel" | "reschedule" | "list" | "document" | "other";
  text: string;
  link?: string;
}

function describe(call: LoggedToolCall, tenantId: string, documents: { id: string; name: string }[]): TestChatAction {
  const r = (call.result ?? {}) as Record<string, unknown>;
  const failed = r.success === false || typeof r.error === "string";
  const why = typeof r.error === "string" ? `: ${r.error}` : "";
  switch (call.name) {
    case "check_availability": {
      const slots = Array.isArray(r.slots) ? r.slots.length : 0;
      return { kind: "availability", text: failed ? `Availability check failed${why}` : `Checked availability for ${String(r.service)}: ${slots} slot${slots === 1 ? "" : "s"} found` };
    }
    case "book_appointment":
      return { kind: "booking", text: failed ? `Booking refused${why}` : `Test booking made: ${String(r.confirmed_label)} (not saved)` };
    case "cancel_appointment":
      return { kind: "cancel", text: failed ? `Cancel failed${why}` : `Test booking cancelled: ${String(r.cancelled_label)}` };
    case "reschedule_appointment":
      return { kind: "reschedule", text: failed ? `Reschedule refused${why}` : `Test booking moved to ${String(r.new_label)}` };
    case "list_my_bookings":
      return { kind: "list", text: "Looked up this customer's bookings" };
    case "send_document": {
      const doc = documents.find((d) => d.name.toLowerCase() === String(call.args.document_name ?? "").toLowerCase());
      if (failed || !doc) return { kind: "document", text: `Couldn't send a file${why}` };
      return { kind: "document", text: `Sent file: ${doc.name}`, link: documentLink(tenantId, doc.id) };
    }
    default:
      return { kind: "other", text: call.name };
  }
}

export type TestChatResult =
  | {
      ok: true;
      reply: string;
      escalate: boolean;
      escalateKind: "handover" | "follow_up" | null;
      escalateReason: string | null;
      actions: TestChatAction[];
    }
  | { ok: false; status: number; error: string };

/** One assistant reply to the owner's test transcript (browser-held; the last turn must be the "customer's"). */
export async function runTestChat(tenantId: string, userId: string, messages: unknown): Promise<TestChatResult> {
  if (!Array.isArray(messages) || messages.length === 0) return { ok: false, status: 400, error: "messages is required" };
  const turns: ChatTurn[] = (messages as Partial<ChatTurn>[]).slice(-MAX_TURNS).map((m) => ({
    role: m?.role === "model" ? "model" : "user",
    text: String(m?.text ?? "").slice(0, MAX_TEXT),
  }));
  // Gemini rejects a conversation that ends on its own turn.
  if (turns[turns.length - 1].role !== "user" || !turns[turns.length - 1].text.trim()) {
    return { ok: false, status: 400, error: "The last message must be the customer's" };
  }

  const rateKey = `testchat:rate:${tenantId}`;
  const count = await connection.incr(rateKey);
  if (count === 1) await connection.expire(rateKey, 3600);
  if (count > MAX_PER_HOUR) {
    return { ok: false, status: 429, error: `Test chat is limited to ${MAX_PER_HOUR} messages an hour. Try again a bit later.` };
  }

  const tenant = await getTenantById(tenantId);
  if (!tenant) return { ok: false, status: 500, error: "Tenant not found" };
  const context = await withTenant(tenantId, (client) => loadBusinessContext(client));

  // The trailing run of customer messages is what this reply answers —
  // same FAQ-lookup input the WhatsApp worker uses for a burst.
  let i = turns.length;
  while (i > 0 && turns[i - 1].role === "user") i--;
  const queryText = turns.slice(i).map((t) => t.text).join("\n");
  const systemPrompt = await buildReplySystemPrompt(tenant, context, queryText, null, "test chat");

  const key = sandboxKey(tenantId, userId);
  const sandbox: SandboxBooking[] = JSON.parse((await connection.get(key)) ?? "[]");
  const tools = [...buildBookingTools(context.services), ...buildDocumentTools(context.documents)];
  const executeTool = (call: ToolCall): Promise<unknown> => {
    if (BOOKING_TOOL_NAMES.includes(call.name)) {
      return executeBookingTool(
        {
          tenantId,
          timezone: tenant.timezone,
          minNoticeMinutes: tenant.bookingMinNoticeMinutes,
          services: context.services,
          conversationId: "",
          contactWaNumber: "test-chat",
          sandbox,
        },
        call,
      );
    }
    if (DOCUMENT_TOOL_NAMES.includes(call.name)) {
      return executeDocumentTool({ tenantId, waPhoneNumberId: null, contactWaNumber: "test-chat", documents: context.documents }, call);
    }
    return Promise.resolve({ error: `Unknown tool "${call.name}"` });
  };

  let result: Awaited<ReturnType<typeof runReplyTurn>>;
  try {
    result = await runReplyTurn(systemPrompt, turns, tools, executeTool);
  } catch (err) {
    console.warn("[testChat] reply failed:", err);
    return {
      ok: false,
      status: 502,
      error: "The assistant couldn't reply just now (the AI service may be busy). On WhatsApp, the customer would get a holding message and the chat would go to you.",
    };
  } finally {
    await connection.set(key, JSON.stringify(sandbox), "EX", SANDBOX_TTL_SECONDS);
  }

  return {
    ok: true,
    reply: result.reply,
    escalate: result.escalate,
    escalateKind: result.escalate ? (result.escalateKind ?? "handover") : null,
    escalateReason: result.escalate ? (result.escalateReason ?? null) : null,
    actions: result.toolCalls.map((c) => describe(c, tenantId, context.documents)),
  };
}

/** "Start over": forget this user's test bookings. */
export async function resetTestChat(tenantId: string, userId: string): Promise<void> {
  await connection.del(sandboxKey(tenantId, userId));
}
