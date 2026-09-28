"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, LayoutGrid, Menu, Workflow } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const NAV_LINKS = [
  { href: "/catalog", label: "Catalog", icon: LayoutGrid },
  { href: "/inbox", label: "Inbox", icon: Inbox },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <>
      {NAV_LINKS.map(({ href, label, icon: Icon }) => {
        const active = pathname?.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </>
  );
}

export function AppNav() {
  return (
    <header className="border-border/60 bg-background/80 sticky top-0 z-40 border-b backdrop-blur-lg">
      <div className="app-container flex h-14 items-center justify-between gap-4 sm:h-16">
        <Link href="/catalog" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-xl">
            <Workflow className="size-4" />
          </span>
          <span className="hidden sm:inline">a2a-agent-workflow-ui</span>
          <span className="sm:hidden">a2a</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          <NavLinks />
        </nav>

        <div className="flex items-center gap-1">
          <ThemeToggle />
          <div className="md:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open navigation">
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent side="right">
                <SheetHeader>
                  <SheetTitle>Navigate</SheetTitle>
                </SheetHeader>
                <nav className="flex flex-col gap-1 px-4">
                  <NavLinks />
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  );
}
