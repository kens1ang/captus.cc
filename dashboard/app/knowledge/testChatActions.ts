"use server";

import { backendFetch, BackendError } from "@/lib/backend";

export interface TestChatTurn {
  role: "user" | "model";
  text: string;
}

export interface TestChatAction {
  kind: "availability" | "booking" | "cancel" | "reschedule" | "list" | "document" | "other";
  text: string;
  link?: string;
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
  | { ok: false; error: string };

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

/** One assistant reply to the test transcript (see backend routes/testChat.ts — nothing is sent or booked for real). */
export async function sendTestMessage(messages: TestChatTurn[]): Promise<TestChatResult> {
  try {
    const res = await backendFetch<Omit<Extract<TestChatResult, { ok: true }>, "ok">>("/api/test-chat", {
      method: "POST",
      body: JSON.stringify({ messages }),
    });
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

/** "Start over": clears the test bookings made in this chat. */
export async function resetTestChat(): Promise<void> {
  await backendFetch("/api/test-chat", { method: "DELETE" });
}
