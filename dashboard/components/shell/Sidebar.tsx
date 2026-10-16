"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { BookOpen, CalendarDays, LayoutDashboard, Menu, MessageSquareText, MessagesSquare, Settings, ShieldCheck, X } from "lucide-react";
import { cx } from "@/components/ui";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: number;
}

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
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
            className={cx(
              "group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
              active ? "bg-hover font-medium text-fg" : "text-muted hover:bg-hover hover:text-fg",
            )}
          >
            <Icon className={cx("size-4 shrink-0", active ? "text-brand" : "text-faint group-hover:text-muted")} />
            <span className="flex-1 truncate">{label}</span>
            {!!badge && (
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
}: {
  businessName: string;
  needsAttention: number;
  isAdmin: boolean;
  footer: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const items: NavItem[] = [
    { href: "/", label: "Overview", icon: LayoutDashboard },
    { href: "/conversations", label: "Inbox", icon: MessagesSquare, badge: needsAttention },
    { href: "/knowledge", label: "Knowledge", icon: BookOpen },
    { href: "/bookings", label: "Bookings", icon: CalendarDays },
    { href: "/templates", label: "Templates", icon: MessageSquareText },
    { href: "/settings", label: "Settings", icon: Settings },
  ];
  const adminItems: NavItem[] = isAdmin ? [{ href: "/admin", label: "All businesses", icon: ShieldCheck }] : [];

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 border-b border-line px-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-brand text-sm font-bold text-brand-fg">C</div>
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
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-line bg-panel md:block">{content}</aside>

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
