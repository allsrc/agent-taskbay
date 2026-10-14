"use client"

import * as React from "react"
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function useCopy(timeout = 1500) {
  const [copied, setCopied] = React.useState(false)
  const copy = React.useCallback(
    async (value: string, label?: string) => {
      try {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        if (label) toast.success(`${label} copied`)
        window.setTimeout(() => setCopied(false), timeout)
      } catch {
        toast.error("Couldn’t access the clipboard")
      }
    },
    [timeout]
  )
  return { copied, copy }
}

export function CopyButton({
  value,
  label = "Copy",
  toastLabel,
  className,
}: {
  value: string
  label?: string
  toastLabel?: string
  className?: string
}) {
  const { copied, copy } = useCopy()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn("text-muted-foreground hover:text-foreground", className)}
            onClick={() => copy(value, toastLabel)}
            aria-label={label}
          />
        }
      >
        {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : label}</TooltipContent>
    </Tooltip>
  )
}

export function CodeBlock({
  code,
  lang,
  title,
  className,
}: {
  code: string
  lang?: string
  title?: string
  className?: string
}) {
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-code text-code-foreground", className)}>
      <div className="flex h-9 items-center justify-between border-b bg-sunken/60 pr-1 pl-3">
        <span className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
          {title ?? lang ?? "code"}
        </span>
        <CopyButton value={code} label="Copy code" />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}

/** A single connection value (endpoint, ID) with copy affordance. */
export function ValueField({
  label,
  value,
  hint,
  secret = false,
  className,
}: {
  label: string
  value: string
  hint?: React.ReactNode
  secret?: boolean
  className?: string
}) {
  const [revealed, setRevealed] = React.useState(!secret)
  const masked = secret && !revealed
  const display = masked ? `${value.slice(0, 9)}${"•".repeat(18)}${value.slice(-4)}` : value

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {hint && <span className="text-xs text-subtle-foreground">{hint}</span>}
      </div>
      <div className="flex h-10 items-center gap-1 rounded-lg border bg-sunken pr-1 pl-3">
        <code className="min-w-0 flex-1 truncate font-mono text-[13px]" aria-label={masked ? `${label} (hidden)` : undefined}>
          {display}
        </code>
        {secret && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </Button>
        )}
        <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} toastLabel={label} />
      </div>
    </div>
  )
}
