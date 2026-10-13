"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { MessagesSquare, Search } from "lucide-react";
import { ContactAvatar, StatusBadge } from "@/components/ConversationStatus";
import { EmptyState, cx } from "@/components/ui";
import { formatPhone, formatRelative } from "@/lib/formatDate";
import type { ConversationStatus, ConversationSummary } from "@/lib/data";

const FILTERS: { value: "all" | ConversationStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "needs_human", label: "Needs you" },
  { value: "human_active", label: "You're replying" },
  { value: "bot", label: "Assistant" },
];

export function ConversationList({ conversations, timezone }: { conversations: ConversationSummary[]; timezone: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const filter = (searchParams.get("filter") as (typeof FILTERS)[number]["value"]) || "all";
  const [query, setQuery] = useState("");

  const counts = Object.fromEntries(FILTERS.map((f) => [f.value, f.value === "all" ? conversations.length : conversations.filter((c) => c.status === f.value).length]));
  const q = query.replace(/\D/g, "") || query.trim().toLowerCase();
  const visible = conversations.filter(
    (c) =>
      (filter === "all" || c.status === filter) &&
      (!q || c.waNumber.includes(q) || (c.lastMessage ?? "").toLowerCase().includes(query.trim().toLowerCase())),
  );

  function setFilter(value: string) {
    const params = new URLSearchParams(searchParams);
    if (value === "all") params.delete("filter");
    else params.set("filter", value);
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-3 border-b border-line p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search number or message"
            className="control pl-9"
            aria-label="Search conversations"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cx(
                "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                filter === f.value ? "bg-fg text-panel" : "text-muted hover:bg-hover hover:text-fg",
              )}
            >
              {f.label}
              <span className={cx("tabular-nums", filter === f.value ? "opacity-70" : "text-faint")}>{counts[f.value]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <EmptyState
            icon={MessagesSquare}
            title={conversations.length ? "No matching conversations" : "No conversations yet"}
            description={conversations.length ? "Try a different filter or search." : "Chats appear here as soon as a customer messages you on WhatsApp."}
          />
        ) : (
          <ul>
            {visible.map((c) => {
              const active = pathname === `/conversations/${c.id}`;
              return (
                <li key={c.id}>
                  <Link
                    href={`/conversations/${c.id}${searchParams.size ? `?${searchParams}` : ""}`}
                    className={cx(
                      "flex gap-3 border-b border-line px-3 py-3 transition-colors",
                      active ? "bg-hover" : "hover:bg-hover/60",
                      c.status === "needs_human" && !active && "bg-warn-soft/40",
                    )}
                  >
                    <ContactAvatar waNumber={c.waNumber} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-medium">{formatPhone(c.waNumber)}</p>
                        <span className="shrink-0 text-[11px] text-faint">{formatRelative(c.lastMessageAt, timezone)}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-sm text-muted">
                        {c.lastMessageDirection === "out" && <span className="text-faint">↩ </span>}
                        {c.lastMessage ?? "No messages"}
                      </p>
                      {c.status !== "bot" && (
                        <div className="mt-1.5">
                          <StatusBadge status={c.status} />
                        </div>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
