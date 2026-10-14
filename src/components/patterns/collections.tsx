import type { Route } from "next"
import Link from "next/link"
import { ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"

import { Skeleton } from "@/components/ui/skeleton"

/* ------------------------------------------------------------------ */
/* ListGroup — native-style grouped list (settings, mobile menus)      */
/* ------------------------------------------------------------------ */

export function ListGroup({
  title,
  footer,
  children,
  className,
}: {
  title?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("space-y-2", className)}>
      {title && <h3 className="px-1 text-xs font-medium text-muted-foreground">{title}</h3>}
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">{children}</ul>
      {footer && <p className="px-1 text-xs text-muted-foreground">{footer}</p>}
    </section>
  )
}

export function ListItem({
  icon: Icon,
  title,
  description,
  trailing,
  href,
  chevron,
  onClick,
  destructive,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: React.ReactNode
  description?: React.ReactNode
  /** Value, badge, switch or button on the right. */
  trailing?: React.ReactNode
  href?: Route
  /** Show a disclosure chevron. Defaults to true for links. */
  chevron?: boolean
  onClick?: () => void
  destructive?: boolean
}) {
  const showChevron = chevron ?? Boolean(href)
  const body = (
    <>
      {Icon && (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-sunken text-muted-foreground">
          <Icon className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm font-medium", destructive && "text-danger")}>{title}</span>
        {description && <span className="block truncate text-xs text-muted-foreground">{description}</span>}
      </span>
      {trailing && <span className="shrink-0 text-sm text-muted-foreground">{trailing}</span>}
      {showChevron && <ChevronRightIcon className="size-4 shrink-0 text-subtle-foreground" />}
    </>
  )
  const rowClass = "flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left"
  const interactive = "pressable transition-colors hover:bg-muted/60 active:bg-muted outline-none focus-visible:bg-muted"
  return (
    <li>
      {href !== undefined ? (
        <Link href={href} onClick={onClick} transitionTypes={["nav-forward"]} className={cn(rowClass, interactive)}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={cn(rowClass, interactive)}>
          {body}
        </button>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* LogStream — monospaced, levelled event output                       */
/* ------------------------------------------------------------------ */

export type LogLine = {
  time: string
  level: "debug" | "info" | "success" | "warn" | "error"
  source?: string
  message: string
}

const levelClass: Record<LogLine["level"], string> = {
  debug: "text-subtle-foreground",
  info: "text-info",
  success: "text-success",
  warn: "text-warning",
  error: "text-danger",
}

export function LogStream({
  lines,
  title = "Output",
  className,
  maxHeight = 280,
}: {
  lines: LogLine[]
  title?: string
  className?: string
  maxHeight?: number
}) {
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-code text-code-foreground", className)}>
      <div className="flex h-9 items-center gap-2 border-b bg-sunken/60 px-3 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
        <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
        {title}
      </div>
      <ol className="overflow-auto p-3 font-mono text-xs leading-6" style={{ maxHeight }} role="log" aria-live="polite">
        {lines.map((line, i) => (
          <li key={i} className="flex gap-3 whitespace-nowrap">
            <span className="text-subtle-foreground tabular-nums">{line.time}</span>
            <span className={cn("w-12 shrink-0 uppercase", levelClass[line.level])}>{line.level}</span>
            {line.source && <span className="w-20 shrink-0 truncate text-muted-foreground">{line.source}</span>}
            <span className="whitespace-pre-wrap">{line.message}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* DataTable — table on desktop, stacked cards on phones               */
/* ------------------------------------------------------------------ */

export type Column<T> = {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  align?: "left" | "right"
  /** Hide this column inside the mobile card (e.g. redundant IDs). */
  hideOnMobile?: boolean
  /** Use as the card title on mobile. */
  primary?: boolean
  className?: string
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  className,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  caption?: string
  className?: string
}) {
  const primary = columns.find((c) => c.primary) ?? columns[0]
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      {/* Desktop */}
      <table className="hidden w-full text-sm md:table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b bg-sunken/50 text-xs text-muted-foreground">
            {columns.map((col) => (
              <th key={col.key} scope="col" className={cn("px-4 py-2.5 font-medium", col.align === "right" ? "text-right" : "text-left")}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="transition-colors hover:bg-muted/40">
              {columns.map((col) => (
                <td key={col.key} className={cn("px-4 py-3", col.align === "right" && "text-right", col.className)}>
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {/* Mobile */}
      <ul className="divide-y md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="space-y-2 p-4">
            <div className="text-sm font-medium">{primary.cell(row)}</div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {columns
                .filter((c) => c !== primary && !c.hideOnMobile)
                .map((col) => (
                  <div key={col.key} className="min-w-0">
                    <dt className="text-muted-foreground">{col.header}</dt>
                    <dd className="truncate">{col.cell(row)}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Toolbar                                                             */
/* ------------------------------------------------------------------ */

/** Horizontal action bar; scrolls sideways on small screens instead of wrapping. */
export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      role="toolbar"
      data-chrome
      className={cn("flex items-center gap-1 overflow-x-auto rounded-xl border bg-card p-1 scrollbar-none", className)}
    >
      {children}
    </div>
  )
}

export function ToolbarSeparator() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
}

/* ------------------------------------------------------------------ */
/* AvatarStack                                                         */
/* ------------------------------------------------------------------ */

export function AvatarStack({
  people,
  max = 4,
  size = "md",
}: {
  people: { name: string; initials: string }[]
  max?: number
  size?: "sm" | "md"
}) {
  const shown = people.slice(0, max)
  const rest = people.length - shown.length
  const dim = size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs"
  return (
    <div className="flex -space-x-2" aria-label={people.map((p) => p.name).join(", ")}>
      {shown.map((p) => (
        <span key={p.name} title={p.name} className={cn("flex items-center justify-center rounded-full border-2 border-background bg-muted font-medium", dim)}>
          {p.initials}
        </span>
      ))}
      {rest > 0 && (
        <span className={cn("flex items-center justify-center rounded-full border-2 border-background bg-sunken font-mono text-muted-foreground", dim)}>
          +{rest}
        </span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Skeleton presets                                                    */
/* ------------------------------------------------------------------ */

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-4 rounded-xl border bg-card p-5", className)} aria-hidden="true">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  )
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y rounded-xl border bg-card" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}
