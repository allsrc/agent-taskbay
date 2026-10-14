import { cn } from "@/lib/utils"

import type { Tone } from "@/lib/tone"

const toneText: Record<Tone, string> = {
  brand: "text-brand-text",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  neutral: "text-muted-foreground",
}

const toneBg: Record<Tone, string> = {
  brand: "bg-brand",
  success: "bg-signal",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-neutral",
}

/** A status dot; `live` adds a soft pulse for in-progress/healthy states. */
export function StatusDot({
  tone = "neutral",
  live = false,
  className,
}: {
  tone?: Tone
  live?: boolean
  className?: string
}) {
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} aria-hidden="true">
      {live && (
        <span className={cn("absolute inset-0 rounded-full motion-safe:animate-pulse-ring", toneBg[tone])} />
      )}
      <span className={cn("relative size-full rounded-full", toneBg[tone])} />
    </span>
  )
}

/** Compact pill used for status, access and other enumerations. */
export function Pill({
  tone = "neutral",
  dot = false,
  live = false,
  icon: Icon,
  children,
  className,
}: {
  tone?: Tone
  dot?: boolean
  live?: boolean
  icon?: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border bg-background/60 px-2.5 text-xs font-medium whitespace-nowrap text-foreground/90",
        className
      )}
    >
      {dot && <StatusDot tone={tone} live={live} />}
      {Icon && <Icon className={cn("size-3.5", toneText[tone])} />}
      {children}
    </span>
  )
}

/** Monospace label — the platform's "technical console" signature. */
export function Eyebrow({
  children,
  className,
  code,
}: {
  children: React.ReactNode
  className?: string
  /** Optional status-code style prefix, e.g. "200". */
  code?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase",
        className
      )}
    >
      {code && <span className="text-brand-text">{code}</span>}
      {children}
    </span>
  )
}

export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md bg-muted px-1.5 font-mono text-[11px] text-muted-foreground",
        className
      )}
    >
      {children}
    </span>
  )
}

export { toneText, toneBg }
