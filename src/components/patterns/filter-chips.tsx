"use client"

import { CheckIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Horizontally scrolling chip row for filters and tags.
 * Single or multi-select; never wraps on mobile, so it reads like a native filter bar.
 */
export function FilterChips({
  options,
  value,
  onValueChange,
  multiple = false,
  label,
  className,
}: {
  options: { value: string; label: string; count?: number }[]
  value: string[]
  onValueChange: (value: string[]) => void
  multiple?: boolean
  label: string
  className?: string
}) {
  const toggle = (option: string) => {
    const selected = value.includes(option)
    if (multiple) onValueChange(selected ? value.filter((v) => v !== option) : [...value, option])
    else onValueChange(selected ? [] : [option])
  }

  return (
    <div role="group" aria-label={label} data-chrome className={cn("-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 scrollbar-none", className)}>
      {options.map((option) => {
        const active = value.includes(option.value)
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(option.value)}
            className={cn(
              "pressable inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs whitespace-nowrap text-muted-foreground outline-none hover:border-border-strong hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
              active && "border-brand/50 bg-brand-soft text-brand-text hover:border-brand/60 hover:text-brand-text"
            )}
          >
            {active && multiple && <CheckIcon className="size-3" />}
            {option.label}
            {option.count !== undefined && (
              <span className="font-mono text-[10.5px] text-subtle-foreground tabular-nums">{option.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
