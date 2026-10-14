import { ArrowRightIcon, ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"

import type { ArchitectureDiagram as Diagram, ArchitectureNode } from "@/lib/architecture"

const kindStyle: Record<NonNullable<ArchitectureNode["kind"]>, string> = {
  client: "border-dashed",
  platform: "border-brand/40 bg-brand-soft",
  service: "",
  external: "border-dashed bg-transparent",
  data: "",
}

const kindLabel: Record<NonNullable<ArchitectureNode["kind"]>, string> = {
  client: "Client",
  platform: "Platform",
  service: "Service",
  external: "External",
  data: "Data",
}

/**
 * Lane-based architecture view. Lanes are columns on wide screens and stack
 * on mobile; flows are listed beneath so the diagram stays legible at any
 * width without fragile connector geometry.
 */
export function ArchitectureDiagram({ diagram, className }: { diagram: Diagram; className?: string }) {
  const byId = Object.fromEntries(diagram.nodes.map((node) => [node.id, node]))

  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      <div className="relative bg-sunken/50 p-4 sm:p-6">
        <div className="absolute inset-0 bg-grid opacity-60 mask-radial" aria-hidden="true" />
        <div
          className="relative grid gap-3 md:gap-0"
          style={{ gridTemplateColumns: `repeat(${diagram.lanes.length}, minmax(0, 1fr))` }}
        >
          {diagram.lanes.map((lane, laneIndex) => (
            <div
              key={lane}
              className="col-span-full flex flex-col gap-2 md:col-span-1 md:flex-row md:items-stretch"
            >
              <div className="flex flex-1 flex-col gap-2">
                <div className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
                  <span className="text-subtle-foreground">{String(laneIndex + 1).padStart(2, "0")}</span> {lane}
                </div>
                <div className="flex flex-1 flex-col justify-center gap-2">
                  {diagram.nodes
                    .filter((node) => node.lane === laneIndex)
                    .map((node) => (
                      <div
                        key={node.id}
                        className={cn(
                          "rounded-lg border bg-card px-3 py-2.5 shadow-xs",
                          node.kind && kindStyle[node.kind]
                        )}
                      >
                        <div className="text-[13px] font-medium">{node.label}</div>
                        {node.detail && <div className="mt-0.5 text-xs text-muted-foreground">{node.detail}</div>}
                      </div>
                    ))}
                </div>
              </div>
              {laneIndex < diagram.lanes.length - 1 && (
                <div className="hidden items-center px-2 pt-5 text-subtle-foreground md:flex" aria-hidden="true">
                  <ChevronRightIcon className="size-4" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="border-t px-4 py-4 sm:px-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Flows</span>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {(["platform", "service", "client", "external"] as const).map((kind) => (
              <span key={kind} className="inline-flex items-center gap-1.5">
                <span className={cn("size-2.5 rounded-sm border bg-card", kindStyle[kind])} />
                {kindLabel[kind]}
              </span>
            ))}
          </div>
        </div>
        <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {diagram.edges.map((edge) => (
            <li key={`${edge.from}-${edge.to}`} className="flex min-w-0 items-center gap-2">
              <span className="truncate">{byId[edge.from]?.label}</span>
              <ArrowRightIcon className="size-3.5 shrink-0 text-brand-text" />
              <span className="truncate">{byId[edge.to]?.label}</span>
              {edge.label && (
                <span className="ml-auto shrink-0 font-mono text-[11px] text-subtle-foreground">{edge.label}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
