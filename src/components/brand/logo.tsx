import { cn } from "@/lib/utils"

/**
 * Agent Taskbay mark: the prompt chevron and cursor, plus a signal dot for
 * live state. Colours come from theme tokens so it adapts to light and dark:
 *   prompt → brand, cursor → foreground, dot → signal.
 */
export function Logomark({
  className,
  animated = false,
  title,
}: {
  className?: string
  /** Pulse the status dot (sign-in, loading moments). */
  animated?: boolean
  /** Accessible name; omit when a visible wordmark sits next to it. */
  title?: string
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("size-7 shrink-0 overflow-visible", className)}
    >
      <path d="M8 16 L32 32 L8 48" className="stroke-brand" strokeWidth="7" strokeLinecap="square" />
      <rect x="36" y="44" width="22" height="8" className="fill-foreground" />
      <circle cx="52" cy="14" r="6" className={cn("fill-signal", animated && "motion-safe:animate-pulse")} />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-heading text-[17px] leading-none tracking-[-0.02em]", className)}>
      <span className="font-light text-muted-foreground">Agent</span>
      <span className="font-bold text-foreground"> Taskbay</span>
    </span>
  )
}

/** Mark + wordmark lockup. */
export function Logo({ className, animated }: { className?: string; animated?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Logomark animated={animated} className="size-6" />
      <Wordmark />
    </span>
  )
}
