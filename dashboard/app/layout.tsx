import type { Metadata } from "next";
import { ClerkProvider, UserButton } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import { auth } from "@clerk/nextjs/server";
import { Link2Off } from "lucide-react";
import { BackendError } from "@/lib/backend";
import { getConversations, getMe, type Me } from "@/lib/data";
import { Sidebar } from "@/components/shell/Sidebar";
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
  title: { default: "Captus", template: "%s · Captus" },
  description: "Your WhatsApp AI assistant — conversations, knowledge and bookings",
  other: {
    "facebook-domain-verification": "25g1sfi0mh6absoik6tm6k8r6yoisk",
  },
};

function NotLinked() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-line bg-panel p-8 text-center shadow-xs">
        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-lg border border-line bg-subtle text-muted">
          <Link2Off className="size-5" />
        </div>
        <h1 className="text-lg font-semibold">Your account isn&apos;t linked to a business yet</h1>
        <p className="mt-2 text-sm text-muted">
          Ask your Captus contact to link this login to your business. Once they do, refresh this page.
        </p>
        <div className="mt-6 flex justify-center">
          <UserButton />
        </div>
      </div>
    </div>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  // A 403 means signed in but not linked to any tenant — show one friendly
  // screen for the whole app instead of every page failing on its own fetch.
  let me: Me;
  try {
    me = await getMe();
  } catch (err) {
    if (err instanceof BackendError && err.status === 403) return <NotLinked />;
    throw err;
  }
  // Inbox badge — best-effort, a hiccup here shouldn't take down every page.
  const needsAttention = await getConversations()
    .then((list) => list.filter((c) => c.status === "needs_human").length)
    .catch(() => 0);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar
        businessName={me.businessName}
        needsAttention={needsAttention}
        isAdmin={me.isAdmin}
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
