"use client";

import { Activity, CircleAlert, RadioTower } from "lucide-react";
import type { SidebandEvent } from "@/shared/types";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PartRenderer } from "./PartRenderer";

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function A2AWrapperSummary({ event }: { event: SidebandEvent }) {
  if (event.metadata?.adapter !== "a2a-wrapper") return null;
  const dataPart = event.parts.find((part) => part.kind === "data" && isObject(part.value));
  const data = dataPart && isObject(dataPart.value) ? dataPart.value : {};
  const usage = isObject(data.usage) ? data.usage : undefined;
  const facts = [
    typeof data.toolKind === "string" ? ["Tool", data.toolKind] : undefined,
    typeof data.status === "string" ? ["Status", data.status] : undefined,
    typeof data.backend === "string" ? ["Backend", data.backend] : undefined,
  ].filter((value): value is string[] => Boolean(value));

  return (
    <div className="border-primary/25 bg-primary/5 mb-2.5 rounded-lg border p-2.5">
      <div className="flex items-center gap-1.5">
        <strong className="text-primary text-xs">a2a-wrapper</strong>
        <span className="text-muted-foreground text-xs">
          Known compatibility adapter · {String(event.metadata.traceType ?? event.type)}
        </span>
      </div>
      {facts.length > 0 && (
        <dl className="mt-2 flex flex-wrap gap-1.5">
          {facts.map(([label, value]) => (
            <div key={label} className="bg-card min-w-[88px] rounded-md px-2 py-1">
              <dt className="text-muted-foreground text-[10px] uppercase">{label}</dt>
              <dd className="text-foreground mt-0.5 font-mono text-xs font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {usage && (
        <dl className="mt-2 flex flex-wrap gap-1.5">
          {(
            [
              ["Input tokens", usage.input_tokens],
              ["Cached input", usage.cached_input_tokens],
              ["Output tokens", usage.output_tokens],
              ["Reasoning tokens", usage.reasoning_output_tokens],
            ] as Array<[string, unknown]>
          ).map(([label, value]) => (
            <div key={label} className="bg-card min-w-[88px] rounded-md px-2 py-1">
              <dt className="text-muted-foreground text-[10px] uppercase">{label}</dt>
              <dd className="text-foreground mt-0.5 font-mono text-xs font-semibold">{Number(value ?? 0).toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function SidebandEventView({ event, allowRaw = false, richJson = false, compact = false, embedded = false }: { event: SidebandEvent; allowRaw?: boolean; richJson?: boolean; compact?: boolean; embedded?: boolean }) {
  const levelColor = event.level === "warning" ? "text-warning" : event.level === "error" ? "text-destructive" : "text-primary";
  return (
    <article className={cn("border-border bg-card overflow-hidden rounded-xl border", compact && "text-sm")}>
      {!embedded && (
        <header className="border-border bg-muted/40 grid grid-cols-[auto_1fr_auto] items-center gap-2.5 border-b px-3 py-2.5">
          <span className={cn("bg-primary/10 flex size-7 items-center justify-center rounded-lg", levelColor)}>
            {event.level === "warning" || event.level === "error" ? <CircleAlert className="size-3.5" /> : <Activity className="size-3.5" />}
          </span>
          <div className="min-w-0">
            <strong className="block truncate text-sm">{event.title}</strong>
            <span className="text-muted-foreground text-xs">{event.type}</span>
          </div>
          <time className="text-muted-foreground text-xs">
            {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </time>
        </header>
      )}
      <div className="p-3">
        <A2AWrapperSummary event={event} />
        <div className="flex flex-col gap-2">
          {event.parts.map((part, index) => (
            <PartRenderer key={`${event.id}-${part.id}-${index}`} part={part} allowRaw={allowRaw} richJson={richJson} />
          ))}
        </div>
      </div>
      {(!compact || embedded) && (
        <footer className="border-border text-muted-foreground flex flex-wrap gap-3 border-t px-3 py-2 text-xs">
          {event.metadata?.adapter === "a2a-wrapper" && (
            <span>
              adapter <code className="font-mono">a2a-wrapper</code>
            </span>
          )}
          {event.references?.taskId && (
            <span>
              task <code className="font-mono">{event.references.taskId}</code>
            </span>
          )}
          {event.references?.traceId && (
            <span>
              trace <code className="font-mono">{event.references.traceId}</code>
            </span>
          )}
          <span title={event.extensionUri}>
            extension <code className="font-mono">{event.extensionUri}</code>
          </span>
        </footer>
      )}
    </article>
  );
}

export function SidebandPanel({ events, allowRaw = false, richJson = false }: { events: SidebandEvent[]; allowRaw?: boolean; richJson?: boolean }) {
  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-4">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sideband events</h1>
          <p className="text-muted-foreground mt-1 text-sm">Optional execution context contributed by a negotiated A2A extension.</p>
        </div>
        <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-full text-xs font-semibold">
          {events.length}
        </span>
      </header>
      {!events.length ? (
        <Card className="items-center border-dashed py-14 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <RadioTower className="text-primary size-7" />
            <p className="font-medium">No sideband events</p>
            <p className="text-muted-foreground text-sm">This agent has not emitted sideband content in the current session.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {events.map((event) => (
            <SidebandEventView key={event.id} event={event} allowRaw={allowRaw} richJson={richJson} />
          ))}
        </div>
      )}
    </section>
  );
}
