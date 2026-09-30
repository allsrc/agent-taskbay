"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PartRenderer } from "@/components/PartRenderer";
import { Chip } from "@/components/a2a/primitives";
import type { NormalizedPart } from "@/lib/types";

/** A message part inside a chat bubble: plain text inline, Markdown rendered, everything else via the full part renderer. */
export function BubblePart({ part, onUser = false }: { part: NormalizedPart; onUser?: boolean }) {
  if (part.kind === "text" && typeof part.value === "string") {
    if (part.mediaType === "text/markdown") {
      return (
        <div className="markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.value}</ReactMarkdown>
        </div>
      );
    }
    return <span className="whitespace-pre-wrap">{part.value}</span>;
  }
  if (onUser) {
    const kind = part.kind === "raw" ? "FILE" : part.kind === "url" ? "URL" : "DATA";
    const name = part.filename ?? (part.kind === "url" ? String(part.value) : part.kind === "data" ? "data" : "file");
    return (
      <div className="border-primary-foreground/30 bg-primary-foreground/10 mt-2 rounded-lg border px-2 py-1.5 font-mono text-[11.5px] font-medium">
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
