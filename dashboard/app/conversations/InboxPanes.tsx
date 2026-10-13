"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * Two-pane inbox: list left, thread right. On small screens only one pane
 * shows at a time — the list at /conversations, the thread once one is open
 * — like a phone messaging app.
 */
export function InboxPanes({ list, children }: { list: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const threadOpen = pathname !== "/conversations";
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] md:h-dvh">
      <div className={cx("w-full shrink-0 border-r border-line bg-panel md:block md:w-80 lg:w-96", threadOpen && "hidden")}>{list}</div>
      <div className={cx("min-w-0 flex-1", !threadOpen && "hidden md:block")}>{children}</div>
    </div>
  );
}
