"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls for fresh data by re-running the current page's Server Component
 * fetch on an interval — the dashboard has no websocket/SSE channel, so this
 * is the simplest way to get new messages/conversations to show up without a
 * manual page refresh. Fine for a low-volume internal dashboard; revisit if
 * this ever needs to scale to many people with conversations open at once.
 */
export function AutoRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
