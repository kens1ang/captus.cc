"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export interface SubNavItem {
  href: string;
  label: string;
  /** undefined = no indicator; true/false = filled-in / not yet. */
  done?: boolean;
  group?: string;
}

/**
 * Secondary navigation for a section with several pages (Knowledge,
 * Settings, Bookings): a vertical list beside the content on desktop, a
 * horizontally scrolling tab strip on small screens.
 */
export function SubNav({ title, items }: { title: string; items: SubNavItem[] }) {
  const pathname = usePathname();
  const groups = [...new Set(items.map((i) => i.group ?? ""))];

  return (
    <>
      <nav className="sticky top-14 z-20 flex gap-1 overflow-x-auto border-b border-line bg-canvas/95 px-4 py-2 backdrop-blur md:hidden">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cx(
                "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm",
                active ? "bg-hover font-medium text-fg" : "text-muted hover:text-fg",
              )}
            >
              {item.done !== undefined && <span className={cx("size-1.5 rounded-full", item.done ? "bg-brand" : "bg-line-strong")} />}
              {item.label}
            </Link>
          );
        })}
      </nav>

      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 overflow-y-auto border-r border-line px-3 py-8 md:block">
        <p className="mb-4 px-2.5 text-lg font-semibold tracking-tight">{title}</p>
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <div key={group}>
              {group && <p className="mb-1.5 px-2.5 text-[11px] font-medium tracking-wider text-faint uppercase">{group}</p>}
              <div className="flex flex-col gap-0.5">
                {items
                  .filter((i) => (i.group ?? "") === group)
                  .map((item) => {
                    const active = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cx(
                          "flex h-8 items-center justify-between gap-2 rounded-md px-2.5 text-sm transition-colors",
                          active ? "bg-hover font-medium text-fg" : "text-muted hover:bg-hover hover:text-fg",
                        )}
                      >
                        <span className="truncate">{item.label}</span>
                        {item.done !== undefined && (
                          <span
                            className={cx("size-1.5 shrink-0 rounded-full", item.done ? "bg-brand" : "bg-line-strong")}
                            title={item.done ? "Filled in" : "Not filled in yet"}
                          />
                        )}
                      </Link>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
