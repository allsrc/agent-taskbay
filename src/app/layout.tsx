import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";

import "./globals.css";
import { IdentityBoundary } from "@/components/identity-boundary";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const fontSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
});

const fontMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "A2A Ops",
  description:
    "The human operations console for A2A agent workflows. Discover agents, operate durable tasks, handle human approvals, and audit work across an A2A agent mesh.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${fontSans.variable} ${fontMono.variable}`}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <IdentityBoundary>{children}</IdentityBoundary>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
