import { config } from "./config.js";
import { GeminiError, classifyFetchError, classifyHttpError, withModelFallback } from "./llmFallback.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Per-call deadlines. Without one, a model that's technically up but crawling
// holds the reply hostage — probed 2026-10-16, gemini-3.8-flash took 169s to
// answer a one-line question. Media gets longer: a PDF or audio upload is
// genuinely more work.
const REPLY_TIMEOUT_MS = 25_000;
const MEDIA_TIMEOUT_MS = 45_000;
const EMBED_TIMEOUT_MS = 10_000;

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

export interface AssistantReply {
  reply: string;
  escalate: boolean;
  escalateReason?: string;
  /**
   * "handover" pauses the assistant for this customer until staff step in
   * (complaints, asking for a person). "follow_up" just tells the owner
   * about something the assistant couldn't answer — it keeps helping with
   * everything else meanwhile.
   */
  escalateKind?: "handover" | "follow_up";
}

// --- Tool-calling agent loop (Stage 5: booking) ---
// Per the architecture doc §5.1: the model gets tool definitions and decides
// which to call; we execute them and feed results back, looping until it
// produces a final reply. Gemini's structured-output mode (responseSchema,
// used pre-Stage-5) can't be combined with function calling in the same
// call, so the final {reply, escalate, escalate_reason} is now itself
// produced via a mandatory "respond_to_customer" tool call instead — same
// typed shape as before, just reached through the tool-calling path so it
// composes with whatever action tools (booking, later invoicing) run first.

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: "OBJECT";
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface LoggedToolCall {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

const RESPOND_TOOL: ToolDeclaration = {
  name: "respond_to_customer",
  description:
    "Ends your turn and sends your reply to the customer on WhatsApp. Call this exactly once, after using any other tools you need first — never answer in plain text instead of calling this.",
  parameters: {
    type: "OBJECT",
    properties: {
      reply: { type: "STRING", description: "The message to send back to the customer." },
      escalate: { type: "BOOLEAN", description: "true if a human should be notified to step in, false otherwise." },
      escalate_reason: { type: "STRING", description: "Short (<15 words) reason, only when escalate is true." },
      escalate_kind: {
        type: "STRING",
        enum: ["handover", "follow_up"],
        description:
          "Only when escalate is true. handover = the customer is upset or complaining, asks for a person, or the matter is sensitive: you stop replying until staff take over. follow_up = you just couldn't answer something from what you know: staff are told, and you keep helping with everything else.",
      },
    },
    required: ["reply", "escalate"],
  },
};

// Hard cap so a model that never wraps up (or ping-pongs between tools)
// can't hang a job forever — the customer still gets a reply either way.
const MAX_TOOL_ITERATIONS = 6;

// Loosely typed on purpose: a returned part can carry fields beyond the ones
// we read (notably `thoughtSignature`, required — see below) that we must
// echo back verbatim without needing to know what they all mean.
interface GeminiPart {
  text?: string;
  functionCall?: ToolCall;
  functionResponse?: { name: string; response: { result: unknown } };
  [key: string]: unknown;
}

interface GeminiContent {
  // Confirmed against the live API: it rejects a "function" role outright
  // ("Role 'function' is not supported... USER, ASSISTANT, ... MODEL")
  // despite that being the commonly-documented convention elsewhere — a
  // functionResponse part goes back as role "user", same as a plain message.
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GenerateResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

/**
 * One generateContent call to one model, with every failure turned into a
 * typed GeminiError (lib/llmFallback.ts) — that's what lets the fallback
 * chain decide whether another model, a later retry, or a human is the fix.
 */
async function generate(model: string, body: unknown, timeoutMs: number): Promise<GenerateResponse> {
  let res: Response;
  try {
    res = await fetch(`${GEMINI_API_BASE}/models/${model}:generateContent?key=${config.gemini.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw classifyFetchError(model, err);
  }
  if (!res.ok) throw classifyHttpError(model, res.status, await res.text());
  try {
    return (await res.json()) as GenerateResponse;
  } catch (err) {
    // The deadline can also fire while the body is still streaming in.
    throw classifyFetchError(model, err);
  }
}

/** A 200 that still has nothing usable in it: blocked prompt, safety stop, cut off mid-answer. */
function unusable(model: string, data: GenerateResponse, what: string): GeminiError {
  const block = data.promptFeedback?.blockReason;
  const finish = data.candidates?.[0]?.finishReason;
  return new GeminiError("bad_output", model, `${what}${block ? ` (prompt blocked: ${block})` : ""}${finish ? ` (finishReason: ${finish})` : ""}`);
}

/** Joined text of the first candidate, or a bad_output error if there isn't any. */
function textOf(model: string, data: GenerateResponse, what: string): string {
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
  if (!text) throw unusable(model, data, `${what} returned no text`);
  return text;
}

/**
 * runReplyTurn failed partway — carries the tool calls that DID run before
 * the failure, because those may have had real side effects (a booking on
 * the calendar). The worker must not blindly retry the whole turn then, or
 * it could book twice.
 */
export class ReplyTurnFailedError extends Error {
  constructor(
    public cause: unknown,
    public toolCalls: LoggedToolCall[],
  ) {
    super(`Reply turn failed after ${toolCalls.length} tool call(s): ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ReplyTurnFailedError";
  }
}

/**
 * Runs one full reply turn: the model may call zero or more `actionTools`
 * (each executed via `executeTool`) before finishing with the mandatory
 * respond_to_customer call. `actionTools` is empty for a tenant with no
 * services configured, which makes this behave exactly like the old
 * structured-output-only `generateReply` — the model just calls
 * respond_to_customer immediately.
 *
 * Throws ReplyTurnFailedError (never a bare error) so the caller always
 * knows which tools already ran.
 */
export async function runReplyTurn(
  systemPrompt: string,
  history: ChatTurn[],
  actionTools: ToolDeclaration[],
  executeTool: (call: ToolCall) => Promise<unknown>,
): Promise<AssistantReply & { toolCalls: LoggedToolCall[] }> {
  const contents: GeminiContent[] = history.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] }));
  const tools = [{ functionDeclarations: [...actionTools, RESPOND_TOOL] }];
  const toolCalls: LoggedToolCall[] = [];

  try {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      // Each step of the loop can land on a different model if one fails
      // mid-turn — `contents` (including tool results already obtained) is
      // carried over as-is, so nothing that already ran is re-executed.
      const { parts, call } = await withModelFallback(config.gemini.replyModels, "reply", async (model) => {
        const data = await generate(
          model,
          {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            tools,
            // "ANY" forces a function call every turn (never plain text) — the
            // model's only way to actually reply is respond_to_customer, so we
            // never have to fall back to sniffing free text for an answer.
            toolConfig: { functionCallingConfig: { mode: "ANY" } },
          },
          REPLY_TIMEOUT_MS,
        );
        const parts = data.candidates?.[0]?.content?.parts ?? [];
        const call = parts.find((p) => !!p.functionCall)?.functionCall;
        if (!call) throw unusable(model, data, "no function call despite toolConfig mode ANY");
        if (call.name === "respond_to_customer" && typeof call.args.reply !== "string") {
          throw unusable(model, data, `respond_to_customer missing "reply": ${JSON.stringify(call.args)}`);
        }
        return { parts, call };
      });

      // Push the model's turn back verbatim (not just a reconstructed
      // {functionCall} part) — parts can carry a `thoughtSignature` field the
      // API requires to be echoed back on the next turn for multi-step tool
      // calling ("Function call is missing a thought_signature..."); dropping
      // it (as an earlier version of this code did) breaks the very next call.
      contents.push({ role: "model", parts });

      if (call.name === "respond_to_customer") {
        const args = call.args as { reply: string; escalate?: boolean; escalate_reason?: string; escalate_kind?: string };
        return {
          reply: args.reply,
          escalate: args.escalate === true,
          escalateReason: args.escalate_reason,
          // Unknown/missing kind → handover: the old, cautious behaviour.
          escalateKind: args.escalate_kind === "follow_up" ? "follow_up" : "handover",
          toolCalls,
        };
      }

      const result = await executeTool(call);
      toolCalls.push({ name: call.name, args: call.args, result });
      contents.push({ role: "user", parts: [{ functionResponse: { name: call.name, response: { result } } }] });
    }
  } catch (err) {
    throw new ReplyTurnFailedError(err, toolCalls);
  }

  // Iteration budget exhausted without a respond_to_customer call — don't
  // leave the customer with silence, and make sure a human finds out.
  return {
    reply: "Sorry, I'm having trouble with that request right now — I've flagged this for the team to follow up with you directly.",
    escalate: true,
    escalateReason: "reply agent exceeded tool-call iteration limit",
    toolCalls,
  };
}

/**
 * Distills a customer's older messages into durable notes (lib/conversationMemory.ts).
 * Merges into any existing summary rather than appending, so it stays bounded
 * however long the relationship runs.
 */
export async function summarizeConversation(existingSummary: string | null, transcript: string): Promise<string> {
  const prompt = `You maintain a short running memory of what a business's assistant knows about ONE customer, from their WhatsApp conversation.

Existing memory:
${existingSummary?.trim() || "(nothing recorded yet)"}

Newer messages, not yet reflected in that memory:
${transcript}

Write the UPDATED memory — the durable facts worth remembering about this customer next time they message.

Rules:
- Merge with the existing memory; don't just append. Drop anything stale or no longer relevant so this stays bounded, under 150 words.
- Facts the customer actually stated only. Never infer, guess, or embellish.
- Include things like: their name, how they prefer to be addressed, stated preferences or constraints, what they've asked about, ongoing issues, anything they'd reasonably expect to be remembered.
- Do NOT record sensitive details a business shouldn't retain (card numbers, ID/passport numbers, passwords, health details they didn't clearly volunteer as relevant).
- Skip routine scheduling logistics already tracked elsewhere (specific appointment times are stored as real bookings, not memory).
- Output plain notes only — no preamble, no headings, no commentary about the task.`;

  return withModelFallback(config.gemini.replyModels, "summary", async (model) =>
    textOf(model, await generate(model, { contents: [{ role: "user", parts: [{ text: prompt }] }] }, REPLY_TIMEOUT_MS), "summary"),
  );
}

/** Basic voice-note handling: transcribe, then feed the transcript through the normal text pipeline. */
export async function transcribeAudio(audioData: Buffer, mimeType: string): Promise<string> {
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: "Transcribe this audio message verbatim. Reply with ONLY the transcript, no commentary." },
          { inlineData: { mimeType, data: audioData.toString("base64") } },
        ],
      },
    ],
  };
  return withModelFallback(config.gemini.mediaModels, "transcription", async (model) =>
    textOf(model, await generate(model, body, MEDIA_TIMEOUT_MS), "transcription"),
  );
}

/**
 * What Gemini can actually take as inline data. Notably NOT xlsx/docx/pptx
 * or archives — those still fall back to the acknowledge-and-escalate path
 * rather than failing mid-analysis.
 */
export function isAnalyzableMedia(mimeType: string): boolean {
  return (
    mimeType.startsWith("image/") ||
    mimeType === "application/pdf" ||
    mimeType.startsWith("text/")
  );
}

/** Inline data has a request-size ceiling, and base64 inflates by ~33% on top — stay well clear of it. */
export const MAX_ANALYZABLE_MEDIA_BYTES = 10 * 1024 * 1024;

/**
 * Turns an image or document into text the normal reply pipeline can use —
 * the same shape as voice-note handling (transcribe, then feed the text
 * through as the customer's message), so history stays plain text and the
 * dashboard shows something meaningful rather than "[unsupported media]".
 */
export async function describeMedia(data: Buffer, mimeType: string, filename?: string): Promise<string> {
  const isImage = mimeType.startsWith("image/");
  const instruction = isImage
    ? `Describe this image for a business's customer-support assistant, who can't see it and has to act on your description alone.
- State plainly what it shows.
- Transcribe ANY text visible in the image verbatim (labels, receipts, screenshots, error messages, handwriting) — this is usually the most important part.
- Describe only what's actually visible. Never guess at brands, prices, or details that aren't legible.
- No preamble. Two or three sentences unless there's a lot of text to transcribe.`
    : `Summarize this document for a business's customer-support assistant, who can't open it and has to act on your summary alone.
- What kind of document it is and what it contains.
- Quote the specific details that matter (names, amounts, dates, reference numbers, any request or question it contains).
- Only what's actually in the document. Never infer or fill in gaps.
- No preamble. Keep it under 200 words.`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: filename ? `${instruction}\n\nThe file is named "${filename}".` : instruction },
          { inlineData: { mimeType, data: data.toString("base64") } },
        ],
      },
    ],
  };
  return withModelFallback(config.gemini.mediaModels, "media description", async (model) =>
    textOf(model, await generate(model, body, MEDIA_TIMEOUT_MS), "media description"),
  );
}

export async function embedText(text: string): Promise<number[]> {
  // Single model on purpose — see config.gemini.embeddingModel. Still typed,
  // so a key/billing problem surfaces the same way as for replies.
  const model = config.gemini.embeddingModel;
  let res: Response;
  try {
    res = await fetch(`${GEMINI_API_BASE}/models/${model}:embedContent?key=${config.gemini.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Pinned to 768 dims to match the knowledge_chunks.embedding column (vector(768)).
      body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: 768 }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
  } catch (err) {
    throw classifyFetchError(model, err);
  }
  if (!res.ok) throw classifyHttpError(model, res.status, await res.text());
  const data = (await res.json()) as { embedding?: { values?: number[] } };
  const values = data.embedding?.values;
  if (!Array.isArray(values)) throw new GeminiError("bad_output", model, `embedding response missing values: ${JSON.stringify(data).slice(0, 300)}`);
  return values;
}
