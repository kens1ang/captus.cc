import type { Metadata } from "next";
import { ClerkProvider, UserButton } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import { auth } from "@clerk/nextjs/server";
import { BackendError } from "@/lib/backend";
import { getConversations, getMe, needsAttention as isNeedsAttention, type Me } from "@/lib/data";
import { Sidebar } from "@/components/shell/Sidebar";
import { CreateBusiness } from "@/components/CreateBusiness";
import { isCollapsed, SIDEBAR_COOKIE } from "@/lib/panelPrefs";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Captus", template: "%s" },
  description: "Your WhatsApp AI assistant — conversations, knowledge and bookings",
  other: {
    "facebook-domain-verification": "25g1sfi0mh6absoik6tm6k8r6yoisk",
  },
};

async function Shell({ children }: { children: React.ReactNode }) {
  // A 403 means signed in but not linked to any business yet — a fresh
  // signup. One screen for the whole app (instead of every page failing on
  // its own fetch) where they create their business and get started.
  let me: Me;
  try {
    me = await getMe();
  } catch (err) {
    if (err instanceof BackendError && err.status === 403) return <CreateBusiness />;
    throw err;
  }
  // Inbox badge — best-effort, a hiccup here shouldn't take down every page.
  const needsAttention = await getConversations()
    .then((list) => list.filter((c) => isNeedsAttention(c.status)).length)
    .catch(() => 0);

  const sidebarCollapsed = await isCollapsed(SIDEBAR_COOKIE);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar
        businessName={me.businessName}
        needsAttention={needsAttention}
        isAdmin={me.isAdmin}
        defaultCollapsed={sidebarCollapsed}
        compactFooter={<UserButton />}
        footer={
          <div className="flex items-center gap-2.5 px-1">
            <UserButton />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-xs font-medium text-fg">{me.email}</p>
              <p className="text-[11px] text-faint capitalize">{me.isAdmin ? "Admin" : me.role}</p>
            </div>
          </div>
        }
      />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { userId } = await auth();

  return (
    <ClerkProvider>
      <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
        <body className="min-h-full">{userId ? <Shell>{children}</Shell> : children}</body>
      </html>
    </ClerkProvider>
  );
}
