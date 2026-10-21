"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cx } from "@/components/ui";
import { SUBNAV_COOKIE, saveCollapsed } from "@/lib/panelPrefsClient";

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
export function SubNav({ title, items, defaultCollapsed = false }: { title: string; items: SubNavItem[]; defaultCollapsed?: boolean }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    saveCollapsed(SUBNAV_COOKIE, !collapsed);
  };
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

      {collapsed ? (
        <aside className="sticky top-0 hidden h-dvh w-11 shrink-0 flex-col items-center border-r border-line py-8 md:flex">
          <button
            type="button"
            onClick={toggleCollapsed}
            title={`Show ${title} menu`}
            aria-label={`Show ${title} menu`}
            className="rounded-md p-1.5 text-faint hover:bg-hover hover:text-fg"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        </aside>
      ) : (
        <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 overflow-y-auto border-r border-line px-3 py-8 md:block">
          <div className="mb-4 flex items-center justify-between gap-2 pl-2.5">
            <p className="text-lg font-semibold tracking-tight">{title}</p>
            <button
              type="button"
              onClick={toggleCollapsed}
              title={`Hide ${title} menu`}
              aria-label={`Hide ${title} menu`}
              className="rounded-md p-1.5 text-faint hover:bg-hover hover:text-fg"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </div>
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
      )}
    </>
  );
}
