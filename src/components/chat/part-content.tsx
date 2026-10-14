"use client";

import { ContentViewer } from "@/components/content-viewer";
import { PartRenderer } from "@/components/PartRenderer";
import { Chip } from "@/components/a2a/primitives";
import type { NormalizedPart } from "@/lib/types";

/** A message part inside a chat bubble: text through the shared content viewer, everything else via the full part renderer. */
export function BubblePart({ part, onUser = false }: { part: NormalizedPart; onUser?: boolean }) {
  if (part.kind === "text" && typeof part.value === "string") {
    return <ContentViewer text={part.value} mediaType={part.mediaType} align={onUser ? "end" : "start"} inferMarkdown={!onUser} />;
  }
  if (onUser && part.kind !== "data") {
    const kind = part.kind === "raw" ? "FILE" : part.kind === "url" ? "URL" : "DATA";
    const name = part.filename ?? (part.kind === "url" ? String(part.value) : "file");
    return (
      <div className="border-border bg-background mt-2 rounded-lg border px-2 py-1.5 font-mono text-[11.5px] font-medium">
        {kind} · {name}
      </div>
    );
  }
  return (
    <div className="mt-1 w-full">
      <PartRenderer part={part} />
    </div>
  );
}

export { Chip };
