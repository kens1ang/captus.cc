import { BackendError } from "./backend";

/** What every form-backed Server Action returns, for <ActionForm> to show "Saved" / an error inline. */
export type ActionState = { ok: boolean; message: string; at: number } | null;

export function ok(message = "Saved"): ActionState {
  return { ok: true, message, at: Date.now() };
}

export function fail(message: string): ActionState {
  return { ok: false, message, at: Date.now() };
}

/** Runs a mutation and turns any backend failure into a readable inline error instead of the page-level error screen. */
export async function attempt(fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const message = await fn();
    return ok(message || "Saved");
  } catch (err) {
    if (err instanceof BackendError) {
      let detail = err.message;
      try {
        detail = (JSON.parse(err.message) as { error?: string; message?: string }).error ?? detail;
      } catch {
        // not JSON — keep the raw text
      }
      return fail(detail || "Something went wrong");
    }
    throw err;
  }
}
