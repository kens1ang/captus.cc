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

// Structured output (rather than a plain-text reply) so the model's escalation
// decision (Stage 2: hand off to a human) is a typed field, not a string we
// have to sniff for keywords.
const REPLY_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    escalate: { type: "BOOLEAN" },
    escalate_reason: { type: "STRING" },
  },
  required: ["reply", "escalate"],
};

export async function generateReply(systemPrompt: string, history: ChatTurn[]): Promise<AssistantReply> {
  const url = `${GEMINI_API_BASE}/models/${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: history.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] })),
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: REPLY_SCHEMA,
      },
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini generateContent failed (${res.status}): ${errBody}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) {
    throw new Error(`Gemini returned no text: ${JSON.stringify(data)}`);
  }

  let parsed: { reply?: string; escalate?: boolean; escalate_reason?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned non-JSON reply despite responseSchema: ${text}`);
  }
  if (typeof parsed.reply !== "string") {
    throw new Error(`Gemini JSON reply missing "reply" field: ${text}`);
  }
  return {
    reply: parsed.reply,
    escalate: parsed.escalate === true,
    escalateReason: parsed.escalate_reason,
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
