"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  BookOpen,
  CalendarDays,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import { cx } from "@/components/ui";
import { BrandMark } from "@/components/BrandMark";
import { SIDEBAR_COOKIE, saveCollapsed } from "@/lib/panelPrefsClient";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: number;
}

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ items, onNavigate, collapsed }: { items: NavItem[]; onNavigate?: () => void; collapsed?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map(({ href, label, icon: Icon, badge }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            title={collapsed ? label : undefined}
            aria-label={collapsed ? label : undefined}
            className={cx(
              "group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
              active ? "bg-hover font-medium text-fg" : "text-muted hover:bg-hover hover:text-fg",
            )}
          >
            <Icon className={cx("size-4 shrink-0", active ? "text-brand" : "text-faint group-hover:text-muted")} />
            {!collapsed && <span className="flex-1 truncate">{label}</span>}
            {!!badge && collapsed && <span className="absolute top-1 right-1 size-2 rounded-full bg-warn" />}
            {!!badge && !collapsed && (
              <span className="rounded-full bg-warn-soft px-1.5 text-[11px] leading-5 font-semibold text-warn tabular-nums">{badge}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar({
  businessName,
  needsAttention,
  isAdmin,
  footer,
  compactFooter,
  defaultCollapsed,
}: {
  businessName: string;
  needsAttention: number;
  isAdmin: boolean;
  footer: ReactNode;
  /** Footer shown when the desktop sidebar is collapsed to icons. */
  compactFooter: ReactNode;
  defaultCollapsed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    saveCollapsed(SIDEBAR_COOKIE, !collapsed);
  };

  const items: NavItem[] = [
    { href: "/", label: "Overview", icon: LayoutDashboard },
    {
      href: "/conversations",
      label: "Inbox",
      icon: MessagesSquare,
      badge: needsAttention,
    },
    { href: "/knowledge", label: "Knowledge", icon: BookOpen },
    { href: "/bookings", label: "Bookings", icon: CalendarDays },
    { href: "/templates", label: "Templates", icon: MessageSquareText },
    { href: "/settings", label: "Settings", icon: Settings },
  ];
  const adminItems: NavItem[] = isAdmin ? [{ href: "/admin", label: "All businesses", icon: ShieldCheck }] : [];

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 border-b border-line pr-10 pl-4">
        <BrandMark className="size-7" />
        <div className="min-w-0 leading-tight">
          <p className="text-sm font-semibold text-fg">Captus</p>
          <p className="truncate text-xs text-muted">{businessName || "Your business"}</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4">
        <NavLinks items={items} onNavigate={() => setOpen(false)} />
        {adminItems.length > 0 && (
          <div>
            <p className="mb-1.5 px-2.5 text-[11px] font-medium tracking-wider text-faint uppercase">Admin</p>
            <NavLinks items={adminItems} onNavigate={() => setOpen(false)} />
          </div>
        )}
      </div>
      <div className="border-t border-line p-3">{footer}</div>
    </div>
  );

  const rail = (
    <div className="flex h-full flex-col items-center">
      <div className="flex h-14 w-full items-center justify-center border-b border-line">
        <BrandMark className="size-7" />
      </div>
      <div className="flex w-full flex-1 flex-col gap-6 overflow-y-auto px-2 py-4">
        <NavLinks items={items} collapsed />
        {adminItems.length > 0 && (
          <div className="border-t border-line pt-4">
            <NavLinks items={adminItems} collapsed />
          </div>
        )}
      </div>
      <div className="flex w-full flex-col items-center gap-3 border-t border-line p-3">
        <CollapseButton collapsed onClick={toggleCollapsed} />
        {compactFooter}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-panel px-4 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="-ml-1 rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg"
          aria-label="Open navigation"
        >
          <Menu className="size-5" />
        </button>
        <p className="truncate text-sm font-semibold">{businessName || "Captus"}</p>
      </div>

      {/* Desktop sidebar */}
      <aside className={cx("sticky top-0 hidden h-screen shrink-0 border-r border-line bg-panel md:block", collapsed ? "w-14" : "w-60")}>
        {collapsed ? (
          rail
        ) : (
          <div className="relative h-full">
            {content}
            <div className="absolute top-3.5 right-2">
              <CollapseButton collapsed={false} onClick={toggleCollapsed} />
            </div>
          </div>
        )}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-line bg-panel shadow-xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-3.5 right-3 rounded-md p-1 text-muted hover:bg-hover hover:text-fg"
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </button>
            {content}
          </aside>
        </div>
      )}
    </>
  );
}

function CollapseButton({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className="rounded-md p-1.5 text-faint hover:bg-hover hover:text-fg">
      <Icon className="size-4" />
    </button>
  );
}
