import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Google_Sans_Code } from "next/font/google";

import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { AppNav } from "@/components/app-nav";

const fontSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
});

const fontMono = Google_Sans_Code({
  variable: "--font-google-sans-code",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "a2a-agent-workflow-ui",
  description:
    "A human-in-the-loop console for Agent2Agent (A2A) workflows: discover an org's registered agents, start tasks, respond to input-required and auth-required steps, and track execution in real time.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${fontSans.variable} ${fontMono.variable}`}>
      <body className="flex min-h-svh flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AppNav />
          <main className="app-container flex-1 py-8 sm:py-10">{children}</main>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
