"use server";

import { revalidatePath } from "next/cache";
import { backendFetch, BackendError } from "@/lib/backend";
import type { ImportPart, ImportState } from "@/lib/data";

// Website / social media import — see the backend's lib/businessImport.ts.
// Each action returns {ok:false,error} instead of throwing, so a failure
// shows inline in the card rather than as the page-level error screen.

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

function errorText(err: unknown): string {
  if (err instanceof BackendError) {
    try {
      return (JSON.parse(err.message) as { error?: string }).error ?? err.message;
    } catch {
      return err.message || "Something went wrong";
    }
  }
  return "Something went wrong";
}

export async function getImport(): Promise<Result<{ import: ImportState | null }>> {
  try {
    return { ok: true, ...(await backendFetch<{ import: ImportState | null }>("/api/import")) };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

export async function startImport(urls: string[]): Promise<Result<{ import: ImportState }>> {
  try {
    return { ok: true, ...(await backendFetch<{ import: ImportState }>("/api/import", { method: "POST", body: JSON.stringify({ urls }) })) };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

export async function applyImport(parts: ImportPart[]): Promise<Result<{ applied: Partial<Record<ImportPart, number>> }>> {
  try {
    const res = await backendFetch<{ applied: Partial<Record<ImportPart, number>> }>("/api/import/apply", {
      method: "POST",
      body: JSON.stringify({ parts }),
    });
    // Every Knowledge page, the sidebar dots and the Overview checklist read this data.
    revalidatePath("/", "layout");
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

export async function dismissImport(): Promise<void> {
  await backendFetch("/api/import", { method: "DELETE" });
}
