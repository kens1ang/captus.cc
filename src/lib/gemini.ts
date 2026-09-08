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

interface GeminiContent {
  // Confirmed against the live API: it rejects a "function" role outright
  // ("Role 'function' is not supported... USER, ASSISTANT, ... MODEL")
  // despite that being the commonly-documented convention elsewhere — a
  // functionResponse part goes back as role "user", same as a plain message.
  role: "user" | "model";
  parts: Array<{ text?: string; functionCall?: ToolCall; functionResponse?: { name: string; response: { result: unknown } } }>;
}

type GeminiFunctionCallPart = { functionCall: ToolCall };

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

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: Array<{ text?: string } | GeminiFunctionCallPart> } }[];
    };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const callPart = parts.find((p): p is GeminiFunctionCallPart => "functionCall" in p && !!p.functionCall);
    if (!callPart) {
      throw new Error(`Gemini returned no function call despite toolConfig mode ANY: ${JSON.stringify(data)}`);
    }
    const call = callPart.functionCall;
    contents.push({ role: "model", parts: [{ functionCall: call }] });

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
