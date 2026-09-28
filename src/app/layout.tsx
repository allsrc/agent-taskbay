import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Inbox, LayoutGrid, Workflow } from "lucide-react";
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
  title: "a2a-agent-workflow-ui",
  description: "A human-in-the-loop console for Agent2Agent (A2A) workflows.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <div className="app-shell">
          <header className="app-topbar">
            <Link className="app-brand" href="/catalog">
              <span className="app-brand-mark"><Workflow size={16} /></span>
              <strong>a2a-agent-workflow-ui</strong>
            </Link>
            <nav className="app-nav">
              <Link href="/catalog"><LayoutGrid size={14} />Catalog</Link>
              <Link href="/inbox"><Inbox size={14} />Inbox</Link>
            </nav>
          </header>
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
