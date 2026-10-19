"use client"

import { useState } from "react"
import Link from "next/link"
import type { Route } from "next"
import { CheckIcon, CopyIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useCopy } from "@/components/patterns/code"
import { ID_KINDS, shortId, type IdKind } from "@/lib/identifiers"
import { cn } from "@/lib/utils"

/**
 * A copy icon for one identifier. It copies the whole value, never the shortened text on screen. It stops the click from
 * reaching a link, a summary or a radio button the icon sits beside.
 */
export function CopyIdButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const { copied, copy } = useCopy()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn("text-muted-foreground hover:text-foreground size-5 shrink-0 rounded-md pointer-coarse:size-8 [&_svg:not([class*='size-'])]:size-3 pointer-coarse:[&_svg:not([class*='size-'])]:size-4", className)}
            aria-label={copied ? `${label} copied` : label}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void copy(value, ID_LABEL_FROM(label))
            }}
          />
        }
      >
        {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : label}</TooltipContent>
    </Tooltip>
  )
}

/** "Copy Task ID" becomes "Task ID" for the toast. */
const ID_LABEL_FROM = (label: string) => label.replace(/^Copy /, "")

/** The explanation opened from an identifier: what it is, the field it comes from, the full value and the sentence saying who creates it. */
function IdentifierHelp({ kind, value, label }: { kind: IdKind; value: string; label: string }) {
  const info = ID_KINDS[kind]
  return (
    <div className="flex max-h-[60dvh] flex-col gap-1.5 overflow-y-auto text-left">
      <p className="text-sm font-semibold">
        {label}
        {info.field && <span className="text-muted-foreground ml-1.5 font-mono text-xs font-normal">{info.field}</span>}
      </p>
      <p className="text-muted-foreground text-xs">{info.origin === "A2A" ? "Defined by the A2A protocol" : "Kept by Taskbay only; the agent never sees it"}</p>
      <p className="bg-sunken rounded-md border px-2 py-1.5 font-mono text-xs break-all select-all">{value}</p>
      <p className="text-xs">{info.help}</p>
    </div>
  )
}

/**
 * One identifier, inline: what it is, a shortened value, and a copy icon. Hover or focus the label for what it is and the full
 * value. Use `label` when the same kind needs a more specific name, such as "Referenced task".
 */
export function Identifier({
  kind,
  value,
  label,
  head = 8,
  full = false,
  className,
}: {
  kind: IdKind
  value: string
  label?: string
  /** How many leading characters to show before the ellipsis. */
  head?: number
  /** Show the whole value, wrapping if it must. */
  full?: boolean
  className?: string
}) {
  const name = label ?? ID_KINDS[kind].label
  return (
    <span className={cn("text-muted-foreground inline-flex min-w-0 max-w-full items-center gap-0.5 text-[11px]", className)}>
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={300}
          aria-label={`${name}: what is this?`}
          className="inline-flex min-w-0 cursor-help items-baseline gap-1.5 rounded px-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:py-1"
        >
          <span className="shrink-0 font-medium">{name}</span>
          <span className={cn("text-foreground/80 font-mono", full ? "break-all" : "truncate")}>{full ? value : shortId(value, head)}</span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))]">
          <IdentifierHelp kind={kind} value={value} label={name} />
        </PopoverContent>
      </Popover>
      <CopyIdButton value={value} label={`Copy ${name}`} />
    </span>
  )
}

/** Values longer than this fold to three lines until asked for in full. A UUID never reaches it; a long opaque ID does. */
export const LONG_ID = 100

/** A long value folded to three lines with a toggle, so one oversized ID cannot take over a panel. The copy icon always copies all of it. */
function FoldedValue({ value, href }: { value: string; href?: string }) {
  const [open, setOpen] = useState(false)
  const long = value.length > LONG_ID
  const text = "font-mono text-xs break-all"
  return (
    <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
      {href
        ? <Link href={href as Route} className={cn(text, "text-brand-text hover:underline", long && !open && "line-clamp-3")}>{value}</Link>
        : <span className={cn(text, long && !open && "line-clamp-3")}>{value}</span>}
      {long && (
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="text-brand-text -my-1 py-1 text-xs hover:underline pointer-coarse:py-2">
          {open ? "Show less" : `Show all ${value.length} characters`}
        </button>
      )}
    </span>
  )
}

/**
 * A list of identifiers, one per row, each with its plain name, protocol field, full value, copy icon and the sentence that
 * says what it is. For detail pages where the explanation should be visible without hovering.
 */
export function IdentifierList({
  items,
  className,
}: {
  items: Array<{ kind: IdKind; value: string | undefined | null; label?: string; /** Make the value a link, such as to a stored task. */ href?: string }>
  className?: string
}) {
  return (
    <dl className={cn("divide-y text-sm", className)}>
      {items.filter((item) => item.value).map((item) => {
        const info = ID_KINDS[item.kind]
        const name = item.label ?? info.label
        return (
          <div key={`${item.kind}:${item.value}`} className="py-2.5 first:pt-0 last:pb-0">
            <dt className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
              {name}
              {info.field && <span className="text-muted-foreground font-mono text-[11px] font-normal">{info.field}</span>}
              <span className="text-muted-foreground text-[11px] font-normal">{info.origin === "A2A" ? "A2A" : "Taskbay only"}</span>
            </dt>
            <dd className="mt-0.5 flex items-start gap-1">
              <FoldedValue value={item.value!} href={item.href} />
              <CopyIdButton value={item.value!} label={`Copy ${name}`} />
            </dd>
            <p className="text-muted-foreground mt-0.5 text-xs">{info.help}</p>
          </div>
        )
      })}
    </dl>
  )
}
