import type { Metadata } from "next";
import { ClerkProvider, Show, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { auth } from "@clerk/nextjs/server";
import { backendFetch, BackendError } from "@/lib/backend";
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
  title: "Captus Dashboard",
  description: "Captus owner dashboard",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Best-effort — signed out (no token yet) or not linked to a tenant (403)
  // should never break the whole layout, just hide the admin-only nav link.
  const { userId } = await auth();
  let isAdmin = false;
  if (userId) {
    try {
      const me = await backendFetch<{ isAdmin: boolean }>("/api/me");
      isAdmin = me.isAdmin;
    } catch (err) {
      if (!(err instanceof BackendError)) throw err;
    }
  }

  return (
    <ClerkProvider>
      <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
        <body className="min-h-full flex flex-col">
          <Show when="signed-in">
            <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <nav className="flex gap-4 text-sm font-medium">
                <Link href="/">Conversations</Link>
                <Link href="/knowledge">Knowledge base</Link>
                <Link href="/documents">Documents</Link>
                <Link href="/bookings">Bookings</Link>
                <Link href="/settings">Settings</Link>
                {isAdmin && <Link href="/admin">Admin</Link>}
              </nav>
              <UserButton />
            </header>
          </Show>
          <main className="flex-1">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
