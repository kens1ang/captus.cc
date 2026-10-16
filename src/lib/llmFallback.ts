import { DateTime } from "luxon";
import { alertOperator } from "./opsAlert.js";

// Every Gemini failure is sorted into one of these, because each needs
// different handling. The deciding questions: would another MODEL help
// (each model has its own quota and capacity), would trying again LATER
// help, and does a person need to fix something?
export type GeminiErrorKind =
  | "rate_limited" //     429, per-minute quota on this model → another model, or wait
  | "quota_exhausted" //  429, per-day quota on this model → another model for the rest of the day
  | "overloaded" //       500/502/503/504, Google's capacity for this model → another model
  | "timeout" //          no answer within our deadline → another model
  | "network" //          couldn't reach Google at all (or connection dropped)
  | "model_not_found" //  404, model renamed/retired → another model, and fix the config
  | "bad_output" //       200 but unusable: safety block, cut off, no tool call → another model may do better
  | "auth" //             401/403, invalid/revoked key, API disabled → every model fails the same way
  | "billing" //          400 FAILED_PRECONDITION, billing/region → every model fails the same way
  | "bad_request"; //     400 INVALID_ARGUMENT, OUR bug (malformed request) → no model will accept it

export class GeminiError extends Error {
  constructor(
    public kind: GeminiErrorKind,
    public model: string,
    message: string,
    public retryAfterMs?: number,
  ) {
    super(`[${kind}] ${model}: ${message}`);
    this.name = "GeminiError";
  }
}

/** Kinds where trying the next model in the chain can help. */
const SWITCHABLE = new Set<GeminiErrorKind>(["rate_limited", "quota_exhausted", "overloaded", "timeout", "network", "model_not_found", "bad_output"]);

/** Kinds that usually clear up within seconds/minutes — worth the job queue retrying the whole reply later. */
const TRANSIENT = new Set<GeminiErrorKind>(["rate_limited", "overloaded", "timeout", "network", "bad_output"]);

export class AllModelsFailedError extends Error {
  constructor(
    public task: string,
    public errors: GeminiError[],
  ) {
    super(`All models failed for ${task}: ${errors.map((e) => e.message).join(" | ")}`);
    this.name = "AllModelsFailedError";
  }
}

/** Would retrying the same request a little later plausibly succeed? Unknown (non-Gemini) errors count as yes, keeping the queue's normal retry behaviour for them. */
export function isTransientFailure(err: unknown): boolean {
  if (err instanceof AllModelsFailedError) return err.errors.some((e) => TRANSIENT.has(e.kind));
  if (err instanceof GeminiError) return TRANSIENT.has(err.kind);
  return true;
}

// --- Classification ---------------------------------------------------------

interface GoogleErrorBody {
  error?: {
    code?: number;
    status?: string;
    message?: string;
    details?: { "@type"?: string; reason?: string; retryDelay?: string; violations?: { quotaId?: string }[] }[];
  };
}

/** Turns a non-2xx Gemini response into a typed error. */
export function classifyHttpError(model: string, status: number, bodyText: string): GeminiError {
  let body: GoogleErrorBody = {};
  try {
    body = JSON.parse(bodyText) as GoogleErrorBody;
  } catch {
    // non-JSON (e.g. an HTML 502 from a proxy) — classify on status alone
  }
  const e = body.error ?? {};
  const message = e.message ?? (bodyText.slice(0, 300) || `HTTP ${status}`);
  const details = e.details ?? [];
  const reasons = details.map((d) => d.reason).filter(Boolean);

  if (status === 429) {
    // QuotaFailure says WHICH limit was hit; RetryInfo says how long to wait.
    const quotaIds = details.flatMap((d) => d.violations ?? []).map((v) => v.quotaId ?? "");
    const delay = details.find((d) => d.retryDelay)?.retryDelay;
    const retryAfterMs = delay ? Math.ceil(parseFloat(delay) * 1000) : undefined;
    const daily = quotaIds.some((q) => /PerDay/i.test(q));
    return new GeminiError(daily ? "quota_exhausted" : "rate_limited", model, message, retryAfterMs);
  }
  if (status === 404) return new GeminiError("model_not_found", model, message);
  if (status === 401 || status === 403) return new GeminiError("auth", model, message);
  if (status === 400) {
    // An invalid key comes back as 400 INVALID_ARGUMENT, not 401.
    if (reasons.includes("API_KEY_INVALID") || /api key/i.test(message)) return new GeminiError("auth", model, message);
    if (e.status === "FAILED_PRECONDITION") return new GeminiError("billing", model, message);
    return new GeminiError("bad_request", model, message);
  }
  if (status >= 500) return new GeminiError("overloaded", model, message);
  return new GeminiError("bad_request", model, message);
}

/** Fetch-level failure (never got an HTTP response). */
export function classifyFetchError(model: string, err: unknown): GeminiError {
  const name = (err as { name?: string })?.name;
  if (name === "TimeoutError" || name === "AbortError") return new GeminiError("timeout", model, "no response before the deadline");
  return new GeminiError("network", model, err instanceof Error ? err.message : String(err));
}

// --- Per-model health -------------------------------------------------------
// A model that just failed is skipped until its cooldown ends, so during an
// outage each new message goes straight to a working model instead of first
// waiting on the broken one. In-memory: backend + worker are one process.

const coolingUntil = new Map<string, number>();

/** Gemini's daily quotas reset at midnight Pacific time. */
function msUntilQuotaReset(): number {
  const now = DateTime.now().setZone("America/Los_Angeles");
  return now.plus({ days: 1 }).startOf("day").diff(now).toMillis();
}

function cooldownMs(err: GeminiError): number {
  switch (err.kind) {
    case "rate_limited":
      return err.retryAfterMs ?? 60_000;
    case "quota_exhausted":
      return msUntilQuotaReset();
    case "overloaded":
      return 30_000;
    case "timeout":
      return 60_000;
    case "model_not_found":
      return 6 * 60 * 60_000;
    default:
      return 0; // network / bad_output: not this model's fault specifically
  }
}

export function isCoolingDown(model: string): boolean {
  return (coolingUntil.get(model) ?? 0) > Date.now();
}

/** Test/ops hook: forget all cooldowns. */
export function resetModelHealth(): void {
  coolingUntil.clear();
}

async function reportFailure(task: string, err: GeminiError): Promise<void> {
  const ms = cooldownMs(err);
  if (ms > 0) coolingUntil.set(err.model, Date.now() + ms);
  console.warn(`[llm] ${task} failed on ${err.model} (${err.kind})${ms ? `, skipping it for ${Math.round(ms / 1000)}s` : ""}: ${err.message}`);

  if (err.kind === "quota_exhausted") {
    await alertOperator(`quota:${err.model}`, `Gemini daily quota used up for ${err.model}. Falling back to other models until it resets (midnight Pacific). Consider a paid tier or raising limits.`);
  } else if (err.kind === "model_not_found") {
    await alertOperator(`notfound:${err.model}`, `Gemini model ${err.model} is unavailable (404 — renamed or retired). Remove it from GEMINI_MODELS / GEMINI_MEDIA_MODELS.`);
  } else if (err.kind === "auth") {
    await alertOperator("auth", `Gemini rejected the API key (${err.message}). Every AI reply is failing — customers are being handed to staff. Check GEMINI_API_KEY.`);
  } else if (err.kind === "billing") {
    await alertOperator("billing", `Gemini refused requests (${err.message}). Likely billing or region — every AI reply is failing.`);
  } else if (err.kind === "bad_request") {
    await alertOperator(`badrequest:${task}`, `Gemini rejected a ${task} request as invalid (${err.message}) — likely a Captus bug. Check the logs.`);
  }
}

/**
 * Runs `attempt` against each model in `chain` until one succeeds. Models in
 * cooldown are skipped (if every model is cooling, the first is tried
 * anyway rather than failing without trying). Errors that another model
 * can't fix (auth, billing, our own bad request) stop immediately.
 */
export async function withModelFallback<T>(chain: string[], task: string, attempt: (model: string) => Promise<T>): Promise<T> {
  const healthy = chain.filter((m) => !isCoolingDown(m));
  const candidates = healthy.length ? healthy : chain.slice(0, 1);
  const errors: GeminiError[] = [];

  for (const model of candidates) {
    try {
      const result = await attempt(model);
      if (model !== chain[0]) console.log(`[llm] ${task} answered by fallback model ${model}`);
      return result;
    } catch (err) {
      if (!(err instanceof GeminiError)) throw err;
      await reportFailure(task, err);
      if (!SWITCHABLE.has(err.kind)) throw err;
      errors.push(err);
    }
  }

  await alertOperator(
    `allfailed:${task}`,
    `Every Gemini model failed for ${task} (${errors.map((e) => `${e.model}: ${e.kind}`).join(", ")}).${task === "reply" ? " Customers are getting a holding reply and being handed to staff." : ""}`,
  );
  throw new AllModelsFailedError(task, errors);
}
