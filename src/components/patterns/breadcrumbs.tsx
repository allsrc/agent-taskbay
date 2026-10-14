import type { Route } from "next"
import Link from "next/link"
import { ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export function Breadcrumbs({
  items,
  className,
}: {
  items: { label: string; href?: Route }[]
  className?: string
}) {
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        {items.map((item, i) => {
          const last = i === items.length - 1
          return (
            <li key={`${item.label}-${i}`} className={cn("flex min-w-0 items-center gap-1", last && "text-foreground")}>
              {item.href && !last ? (
                <Link href={item.href} className="truncate transition-colors hover:text-foreground">
                  {item.label}
                </Link>
              ) : (
                <span className="truncate" aria-current={last ? "page" : undefined}>
                  {item.label}
                </span>
              )}
              {!last && <ChevronRightIcon className="size-3.5 shrink-0 text-subtle-foreground" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
