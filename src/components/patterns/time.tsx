"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

// One shared ticking clock for every time-aware component on the page.
let clockNow = 0
const clockListeners = new Set<() => void>()
let clockTimer: number | undefined

function subscribeClock(callback: () => void) {
  clockListeners.add(callback)
  if (clockTimer === undefined) {
    clockNow = Date.now()
    clockTimer = window.setInterval(() => {
      clockNow = Date.now()
      clockListeners.forEach((listener) => listener())
    }, 1000)
  }
  return () => {
    clockListeners.delete(callback)
    if (clockListeners.size === 0) {
      window.clearInterval(clockTimer)
      clockTimer = undefined
    }
  }
}

/** Current time, ticking each second on the client; `null` during SSR. */
function useNow() {
  return React.useSyncExternalStore(
    subscribeClock,
    () => clockNow || (clockNow = Date.now()),
    () => null
  )
}

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => n.toString().padStart(2, "0")
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export function Countdown({
  to,
  className,
  expiredLabel = "Expired",
}: {
  /** ISO deadline. */
  to: string
  className?: string
  expiredLabel?: string
}) {
  const now = useNow()
  const remaining = now === null ? null : new Date(to).getTime() - now
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {remaining === null ? "--:--" : remaining <= 0 ? expiredLabel : formatDuration(remaining)}
    </span>
  )
}

/** Fraction of a session's lifetime that remains (0–1). */
export function useRemaining(from: string, to: string) {
  const now = useNow()
  if (now === null) return null
  const start = new Date(from).getTime()
  const end = new Date(to).getTime()
  return Math.min(1, Math.max(0, (end - now) / (end - start)))
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" })

export function formatRelative(iso: string, now: number) {
  const diff = (new Date(iso).getTime() - now) / 1000
  const abs = Math.abs(diff)
  if (abs < 45) return "just now"
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute")
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour")
  return rtf.format(Math.round(diff / 86_400), "day")
}

export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const now = useNow()
  return (
    <time dateTime={iso} className={className} title={new Date(iso).toUTCString()}>
      {now === null ? " " : formatRelative(iso, now)}
    </time>
  )
}

export function ClockTime({ iso, className }: { iso: string; className?: string }) {
  const now = useNow()
  return (
    <time dateTime={iso} className={cn("font-mono tabular-nums", className)}>
      {now === null
        ? "--:--:--"
        : new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
    </time>
  )
}
