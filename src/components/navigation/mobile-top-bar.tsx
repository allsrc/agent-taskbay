"use client"

import type { Route } from "next"
import { Suspense } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronLeftIcon } from "lucide-react"
import { cn } from "@/lib/utils"

import { Logo } from "@/components/brand/logo"

import { useScreenTitle, useScrolledPast } from "./screen-title"

/**
 * Persistent top bar for phones.
 * - Root screens show the brand mark.
 * - Detail screens show a back button to their parent (animated as a "pop").
 * - The screen title fades into the bar once the large title scrolls away.
 */
export function MobileTopBar({
  homeHref,
  parentOf,
  trailing,
  className,
}: {
  homeHref: Route
  /** Map a pathname to its parent screen, or null for root screens. */
  parentOf: (pathname: string) => Route | null
  trailing?: React.ReactNode
  className?: string
}) {
  return (
    <header
      data-chrome
      style={{ viewTransitionName: "top-bar" }}
      className={cn("sticky top-0 z-40 border-b bg-background/85 pt-safe backdrop-blur-xl backdrop-saturate-150 md:hidden", className)}
    >
      <div className="relative flex h-12 items-center gap-2 px-2">
        <Suspense fallback={<Leading homeHref={homeHref} parent={null} />}>
          <ActiveLeading homeHref={homeHref} parentOf={parentOf} />
        </Suspense>
        <CenterTitle />
        <div className="ml-auto flex items-center gap-0.5 pr-1">{trailing}</div>
      </div>
    </header>
  )
}

function ActiveLeading({ homeHref, parentOf }: { homeHref: Route; parentOf: (pathname: string) => Route | null }) {
  return <Leading homeHref={homeHref} parent={parentOf(usePathname())} />
}

function Leading({ homeHref, parent }: { homeHref: Route; parent: Route | null }) {
  if (parent) {
    return (
      <Link
        href={parent}
        transitionTypes={["nav-back"]}
        className="pressable inline-flex h-9 items-center gap-0.5 rounded-lg pr-2 pl-1 text-sm font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label="Back"
      >
        <ChevronLeftIcon className="size-5" />
        Back
      </Link>
    )
  }
  return (
    <Link href={homeHref} aria-label="Agent Taskbay home" className="inline-flex h-9 items-center px-2">
      <Logo />
    </Link>
  )
}

function CenterTitle() {
  const title = useScreenTitle()
  const scrolled = useScrolledPast()
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-x-24 truncate text-center text-sm font-semibold transition-[opacity,transform] duration-200",
        scrolled && title ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      )}
    >
      {title}
    </span>
  )
}
