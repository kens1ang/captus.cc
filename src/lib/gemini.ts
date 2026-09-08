import { config } from "./config.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

export interface AssistantReply {
  reply: string;
  escalate: boolean;
  escalateReason?: string;
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

/**
 * Runs one full reply turn: the model may call zero or more `actionTools`
 * (each executed via `executeTool`) before finishing with the mandatory
 * respond_to_customer call. `actionTools` is empty for a tenant with no
 * services configured, which makes this behave exactly like the old
 * structured-output-only `generateReply` — the model just calls
 * respond_to_customer immediately.
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

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const url = `${GEMINI_API_BASE}/models/${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        tools,
        // "ANY" forces a function call every turn (never plain text) — the
        // model's only way to actually reply is respond_to_customer, so we
        // never have to fall back to sniffing free text for an answer.
        toolConfig: { functionCallingConfig: { mode: "ANY" } },
      }),
    });
    if (!res.ok) throw new Error(`Gemini generateContent failed (${res.status}): ${await res.text()}`);

    const data = (await res.json()) as { candidates?: { content?: { parts?: GeminiPart[] } }[] };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const callPart = parts.find((p) => !!p.functionCall);
    if (!callPart) {
      throw new Error(`Gemini returned no function call despite toolConfig mode ANY: ${JSON.stringify(data)}`);
    }
    const call = callPart.functionCall!;
    // Push the model's turn back verbatim (not just a reconstructed
    // {functionCall} part) — parts can carry a `thoughtSignature` field the
    // API requires to be echoed back on the next turn for multi-step tool
    // calling ("Function call is missing a thought_signature..."); dropping
    // it (as an earlier version of this code did) breaks the very next call.
    contents.push({ role: "model", parts });

    if (call.name === "respond_to_customer") {
      const args = call.args as { reply?: string; escalate?: boolean; escalate_reason?: string };
      if (typeof args.reply !== "string") {
        throw new Error(`respond_to_customer missing "reply": ${JSON.stringify(call.args)}`);
      }
      return { reply: args.reply, escalate: args.escalate === true, escalateReason: args.escalate_reason, toolCalls };
    }

    const result = await executeTool(call);
    toolCalls.push({ name: call.name, args: call.args, result });
    contents.push({ role: "user", parts: [{ functionResponse: { name: call.name, response: { result } } }] });
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

  const url = `${GEMINI_API_BASE}/models/${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) throw new Error(`Gemini summarizeConversation failed (${res.status}): ${await res.text()}`);

  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
  if (!text) throw new Error(`Gemini summarizeConversation returned no text: ${JSON.stringify(data)}`);
  return text;
}

/** Basic voice-note handling: transcribe, then feed the transcript through the normal text pipeline. */
export async function transcribeAudio(audioData: Buffer, mimeType: string): Promise<string> {
  const url = `${GEMINI_API_BASE}/models/${config.gemini.transcriptionModel}:generateContent?key=${config.gemini.apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: "Transcribe this audio message verbatim. Reply with ONLY the transcript, no commentary." },
            { inlineData: { mimeType, data: audioData.toString("base64") } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini audio transcription failed (${res.status}): ${errBody}`);
  }
  const responseData = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = responseData.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
  if (!text) {
    throw new Error(`Gemini transcription returned no text: ${JSON.stringify(responseData)}`);
  }
  return text;
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

  const url = `${GEMINI_API_BASE}/models/${config.gemini.transcriptionModel}:generateContent?key=${config.gemini.apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: filename ? `${instruction}\n\nThe file is named "${filename}".` : instruction },
            { inlineData: { mimeType, data: data.toString("base64") } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Gemini media description failed (${res.status}): ${await res.text()}`);

  const responseData = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = responseData.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
  if (!text) throw new Error(`Gemini media description returned no text: ${JSON.stringify(responseData)}`);
  return text;
}

export async function embedText(text: string): Promise<number[]> {
  const url = `${GEMINI_API_BASE}/models/${config.gemini.embeddingModel}:embedContent?key=${config.gemini.apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Pinned to 768 dims to match the knowledge_chunks.embedding column (vector(768)).
    body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: 768 }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini embedContent failed (${res.status}): ${errBody}`);
  }
  const data = (await res.json()) as { embedding?: { values?: number[] } };
  const values = data.embedding?.values;
  if (!Array.isArray(values)) {
    throw new Error(`Gemini embedding response missing values: ${JSON.stringify(data)}`);
  }
  return values;
}
