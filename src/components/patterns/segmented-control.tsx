"use client"

import { cn } from "@/lib/utils"

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  icon?: React.ComponentType<{ className?: string }>
  /** Hide the label visually (icon-only); kept for screen readers. */
  iconOnly?: boolean
}

/**
 * Pill-shaped single-choice control — for view modes, theme, time ranges.
 * Prefer Tabs when the choice swaps a whole panel of content.
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  size = "md",
  label,
  className,
  stretch = false,
}: {
  value: T
  onValueChange: (value: T) => void
  options: SegmentedOption<T>[]
  size?: "sm" | "md"
  label: string
  className?: string
  stretch?: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border bg-sunken p-0.5",
        stretch && "flex w-full",
        className
      )}
    >
      {options.map(({ value: optionValue, label: optionLabel, icon: Icon, iconOnly }) => {
        const active = optionValue === value
        return (
          <button
            key={optionValue}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={iconOnly ? optionLabel : undefined}
            title={iconOnly ? optionLabel : undefined}
            onClick={() => onValueChange(optionValue)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-full font-medium text-muted-foreground transition-[color,background-color,box-shadow] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
              size === "sm" ? "h-7 text-xs" : "h-8 text-sm",
              iconOnly ? (size === "sm" ? "w-7" : "w-8") : size === "sm" ? "px-2.5" : "px-3",
              stretch && "flex-1",
              active && "bg-card text-foreground shadow-sm ring-1 ring-border"
            )}
          >
            {Icon && <Icon className="size-3.5" />}
            {!iconOnly && optionLabel}
          </button>
        )
      })}
    </div>
  )
}
