"use client";

import { buttonVariants } from "@/components/ui/button";
import { useState } from "react";
import { ContentViewer, CsvTable, DataTable } from "@/components/content-viewer";
import { Code2, Download, Eye, FileText, Sparkles, Table2 } from "lucide-react";
import type { NormalizedPart } from "@/lib/types";
import { isTabular, safeContentUrl } from "@/lib/content";
import { canUseRichJsonView } from "@/lib/rich-json";
import { cn } from "@/lib/utils";
import { JsonTree } from "./JsonTree";
import { RichJsonView } from "./RichJsonView";

type View = "rendered" | "structured" | "experimental" | "raw";

function ViewButton({
  active,
  onClick,
  title,
  children,
  wide = false,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "text-muted-foreground inline-flex h-6 items-center justify-center gap-1 rounded px-1.5 text-[10px] font-semibold transition-colors",
        wide && "px-2",
        active && "bg-background text-foreground shadow-sm",
      )}
    >
      {children}
    </button>
  );
}

export function PartRenderer({ part, allowRaw = false, richJson = false }: { part: NormalizedPart; allowRaw?: boolean; richJson?: boolean }) {
  const [view, setView] = useState<View>("rendered");
  const url = typeof window === "undefined" ? undefined : safeContentUrl(part);
  const mime = part.mediaType || "application/octet-stream";
  const text = typeof part.value === "string" ? part.value : JSON.stringify(part.value, null, 2) ?? "";
  const isJson = part.kind === "data" || mime.includes("json");
  const canStructure = isJson || (part.kind === "text" && mime.includes("csv"));
  const canUseExperimentalView = canUseRichJsonView(part, richJson);
  const activeView = (!allowRaw && view === "raw") || (!canUseExperimentalView && view === "experimental") ? "rendered" : view;

  return (
    <section className="border-border bg-card w-full overflow-hidden rounded-xl border">
      <header className="border-border bg-muted/40 flex min-h-9 items-center justify-between gap-2 border-b px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-muted-foreground font-mono text-[10px]">{mime}</span>
          {part.filename && <span className="truncate text-[11px]">{part.filename}</span>}
        </div>
        <div className="bg-background border-border inline-flex shrink-0 gap-0.5 rounded-md border p-0.5" aria-label="Content view">
          <ViewButton active={activeView === "rendered"} onClick={() => setView("rendered")} title="Rendered">
            <Eye className="size-3.5" />
          </ViewButton>
          {canStructure && (
            <ViewButton active={activeView === "structured"} onClick={() => setView("structured")} title="Structured">
              <Table2 className="size-3.5" />
            </ViewButton>
          )}
          {canUseExperimentalView && (
            <ViewButton active={activeView === "experimental"} onClick={() => setView("experimental")} title="Experimental rich UI" wide>
              <Sparkles className="size-3" />
              Experimental
            </ViewButton>
          )}
          {allowRaw && (
            <ViewButton active={activeView === "raw"} onClick={() => setView("raw")} title="Raw">
              <Code2 className="size-3.5" />
            </ViewButton>
          )}
        </div>
      </header>
      {/* A large payload scrolls inside the card instead of stretching the conversation. */}
      <div className="max-h-[min(70dvh,640px)] overflow-auto p-3">
        {activeView === "raw" ? (
          <pre className="bg-muted/40 overflow-auto rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap">{JSON.stringify(part, null, 2)}</pre>
        ) : activeView === "experimental" ? (
          <RichJsonView value={part.value} />
        ) : activeView === "structured" && isJson ? (
          isTabular(part.value) ? <DataTable rows={part.value} /> : <JsonTree value={part.value} />
        ) : activeView === "structured" && typeof part.value === "string" ? (
          <CsvTable text={part.value} />
        ) : part.kind === "text" ? (
          <div className="text-sm leading-relaxed"><ContentViewer text={text} mediaType={mime} /></div>
        ) : mime.startsWith("image/") && url ? (
          <a href={url} target="_blank" rel="noreferrer">
            {/* Agent URLs and data URIs are intentionally not passed through Next's image proxy. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="mx-auto block max-h-[560px] max-w-full rounded-lg" src={url} alt={part.filename || "Agent-generated image"} />
          </a>
        ) : mime.startsWith("audio/") && url ? (
          <audio controls src={url} className="w-full" />
        ) : mime.startsWith("video/") && url ? (
          <video className="mx-auto block max-h-[560px] max-w-full rounded-lg" controls src={url} />
        ) : mime === "application/pdf" && url ? (
          <div>
            <iframe className="border-border h-[min(65vh,650px)] w-full rounded-lg border" src={url} title={part.filename || "PDF artifact"} sandbox="allow-same-origin" />
            <a className={buttonVariants({ variant: "outline", size: "sm", className: "mt-2" })} href={url} download={part.filename}>
              <Download className="size-3.5" />
              Download PDF
            </a>
          </div>
        ) : isJson ? (
          isTabular(part.value) ? <DataTable rows={part.value} /> : <JsonTree value={part.value} />
        ) : mime.includes("csv") && typeof part.value === "string" ? (
          <CsvTable text={part.value} />
        ) : url ? (
          <a className="hover:bg-accent flex items-center gap-2.5 rounded-lg p-2 no-underline" href={url} download={part.filename}>
            <FileText className="text-muted-foreground size-5 shrink-0" />
            <span className="flex flex-1 flex-col text-sm">
              {part.filename || "Agent output"}
              <small className="text-muted-foreground text-xs">{mime}</small>
            </span>
            <Download className="text-muted-foreground size-4 shrink-0" />
          </a>
        ) : (
          <pre className="bg-muted/40 overflow-auto rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap">{text}</pre>
        )}
      </div>
    </section>
  );
}
