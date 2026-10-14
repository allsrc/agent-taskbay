"use client"

import { Suspense } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

import { isActive, type NavItem } from "@/lib/navigation"

export type TabBarItem = NavItem | { title: string; icon: NavItem["icon"]; onSelect: () => void; href?: undefined }

/**
 * Native-style bottom tab bar for phones. Shared by the public site and the
 * app, so moving between them never changes the navigation model.
 */
export function TabBar({ items, className }: { items: TabBarItem[]; className?: string }) {
  return (
    <nav
      aria-label="Primary"
      data-chrome
      style={{ viewTransitionName: "tab-bar" }}
      className={cn("fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-safe backdrop-blur-xl backdrop-saturate-150 md:hidden", className)}
    >
      <Suspense fallback={<Tabs items={items} pathname={null} />}>
        <ActiveTabs items={items} />
      </Suspense>
    </nav>
  )
}

function ActiveTabs({ items }: { items: TabBarItem[] }) {
  return <Tabs items={items} pathname={usePathname()} />
}

function Tabs({ items, pathname }: { items: TabBarItem[]; pathname: string | null }) {
  return (
    <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item) => {
        const active = item.href !== undefined && pathname !== null && isActive(pathname, item)
        const inner = (
          <>
            <span
              className={cn(
                "flex h-7 w-14 items-center justify-center rounded-full transition-colors duration-200",
                active && "bg-muted"
              )}
            >
              <item.icon className={cn("size-[19px] transition-transform", active && "scale-105")} strokeWidth={active ? 2.25 : 2} />
            </span>
            <span className={cn("text-[11px] leading-none", active ? "font-medium text-foreground" : "")}>{item.title}</span>
          </>
        )
        const cls = cn(
          "flex h-[3.75rem] w-full flex-col items-center justify-center gap-1 text-muted-foreground outline-none transition-colors active:text-foreground focus-visible:text-foreground",
          active && "text-foreground"
        )
        return (
          <li key={item.title}>
            {item.href !== undefined ? (
              <Link href={item.href} aria-current={active ? "page" : undefined} className={cls}>
                {inner}
              </Link>
            ) : (
              <button type="button" onClick={item.onSelect} className={cls}>
                {inner}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
