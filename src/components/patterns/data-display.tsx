import { ArrowDownRightIcon, ArrowUpRightIcon, CheckIcon, MinusIcon } from "lucide-react"
import { cn } from "@/lib/utils"

import type { Tone } from "@/lib/tone"

import { toneBg, toneText } from "./status"

/* ------------------------------------------------------------------ */
/* Sparkline                                                           */
/* ------------------------------------------------------------------ */

/** Tiny inline trend line. Colour follows `currentColor`. */
export function Sparkline({
  data,
  className,
  fill = true,
}: {
  data: number[]
  className?: string
  fill?: boolean
}) {
  const w = 100
  const h = 32
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const points = data.map((v, i) => [(i / (data.length - 1)) * w, h - 2 - ((v - min) / range) * (h - 4)] as const)
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-8 w-full overflow-visible", className)} aria-hidden="true">
      {fill && <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="currentColor" fillOpacity={0.1} />}
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* StatTile                                                            */
/* ------------------------------------------------------------------ */

/** A single metric with optional delta and trend. */
export function StatTile({
  label,
  value,
  unit,
  delta,
  deltaIntent = "up-good",
  trend,
  icon: Icon,
  className,
}: {
  label: string
  value: React.ReactNode
  unit?: string
  /** Percentage change, e.g. 12.4 or -3 */
  delta?: number
  /** Whether a rising number is good (requests) or bad (latency, errors). */
  deltaIntent?: "up-good" | "up-bad"
  trend?: number[]
  icon?: React.ComponentType<{ className?: string }>
  className?: string
}) {
  const good = delta === undefined ? null : deltaIntent === "up-good" ? delta >= 0 : delta <= 0
  const DeltaIcon = delta === undefined || delta === 0 ? MinusIcon : delta > 0 ? ArrowUpRightIcon : ArrowDownRightIcon
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4", className)}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1">
          <span className="font-heading text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
          {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
        </div>
        {delta !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-mono text-[11px] tabular-nums",
              good ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
            )}
          >
            <DeltaIcon className="size-3" />
            {Math.abs(delta)}%
          </span>
        )}
      </div>
      {trend && <Sparkline data={trend} className={good === false ? "text-danger" : "text-brand"} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* ProgressRing                                                        */
/* ------------------------------------------------------------------ */

/** Circular progress — session lifetime, quotas, completion. */
export function ProgressRing({
  value,
  size = 40,
  stroke = 4,
  tone = "brand",
  label,
  className,
}: {
  /** 0–1 */
  value: number
  size?: number
  stroke?: number
  tone?: Tone
  label?: React.ReactNode
  className?: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.min(1, Math.max(0, value))
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", toneText[tone], className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      {label !== undefined && (
        <span className="absolute font-mono text-[10px] font-medium text-foreground tabular-nums">{label}</span>
      )}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Callout & Banner                                                    */
/* ------------------------------------------------------------------ */

const calloutTone: Record<Tone, string> = {
  brand: "border-brand/30 bg-brand-soft",
  success: "border-success/30 bg-success/[0.06]",
  warning: "border-warning/35 bg-warning/[0.07]",
  danger: "border-danger/30 bg-danger/[0.06]",
  info: "border-info/30 bg-info/[0.06]",
  neutral: "bg-sunken",
}

/** Inline contextual message inside content. */
export function Callout({
  tone = "info",
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  tone?: Tone
  icon?: React.ComponentType<{ className?: string }>
  title?: React.ReactNode
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-lg border p-3.5 text-sm", calloutTone[tone], className)}
    >
      {Icon && <Icon className={cn("mt-0.5 size-4 shrink-0", toneText[tone])} />}
      <div className="min-w-0 flex-1 space-y-1">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className="leading-relaxed text-muted-foreground">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}

/** Full-width strip for platform-level announcements (maintenance, launches). */
export function Banner({
  tone = "brand",
  children,
  action,
  className,
}: {
  tone?: Tone
  children: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex items-center justify-center gap-3 border-b px-4 py-2 text-center text-xs", calloutTone[tone], className)}>
      <span className={cn("size-1.5 shrink-0 rounded-full", toneBg[tone])} aria-hidden="true" />
      <span className="text-foreground/90">{children}</span>
      {action}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Stepper                                                             */
/* ------------------------------------------------------------------ */

export type StepState = "complete" | "current" | "upcoming" | "error"

/** Progress through a multi-step flow (launch, onboarding, guided runs). */
export function Stepper({
  steps,
  orientation = "horizontal",
  className,
}: {
  steps: { title: string; description?: string; state: StepState }[]
  orientation?: "horizontal" | "vertical"
  className?: string
}) {
  const vertical = orientation === "vertical"
  return (
    <ol className={cn(vertical ? "space-y-0" : "flex items-start", className)}>
      {steps.map((step, i) => {
        const last = i === steps.length - 1
        return (
          <li
            key={step.title}
            aria-current={step.state === "current" ? "step" : undefined}
            className={cn("relative", vertical ? "flex gap-3 pb-6 last:pb-0" : "flex flex-1 flex-col items-start gap-2 last:flex-none")}
          >
            <div className={cn("flex items-center", !vertical && "w-full")}>
              <span
                className={cn(
                  "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]",
                  step.state === "complete" && "border-brand bg-brand text-brand-foreground",
                  step.state === "current" && "border-foreground bg-card text-foreground ring-4 ring-foreground/10",
                  step.state === "upcoming" && "bg-card text-muted-foreground",
                  step.state === "error" && "border-danger bg-danger text-white"
                )}
              >
                {step.state === "complete" ? <CheckIcon className="size-3.5" /> : i + 1}
              </span>
              {!last && !vertical && (
                <span className={cn("mx-2 h-px flex-1", step.state === "complete" ? "bg-brand" : "bg-border")} />
              )}
            </div>
            {!last && vertical && (
              <span
                className={cn("absolute top-7 bottom-1 left-3 w-px -translate-x-1/2", step.state === "complete" ? "bg-brand" : "bg-border")}
                aria-hidden="true"
              />
            )}
            <div className={cn("min-w-0", !vertical && "pr-3")}>
              <div className={cn("text-sm font-medium", step.state === "upcoming" && "text-muted-foreground")}>{step.title}</div>
              {step.description && <div className="text-xs text-muted-foreground">{step.description}</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
