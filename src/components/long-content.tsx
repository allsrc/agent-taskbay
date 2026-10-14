"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ClampSize = "normal" | "compact";

const LIMITS: Record<ClampSize, { lines: number; chars: number; height: string }> = {
  // About 20 lines of chat text, then a fade.
  normal: { lines: 20, chars: 2400, height: "max-h-96" },
  // Progress steps and values inside JSON stay short until opened.
  compact: { lines: 6, chars: 600, height: "max-h-32" },
};

const countLines = (text: string) => {
  let lines = 1;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) lines += 1;
  return lines;
};

/** How long a piece of text is, and whether it is long enough to fold at this size. */
export function measure(text: string, size: ClampSize) {
  const lines = countLines(text);
  const limit = LIMITS[size];
  return { lines, chars: text.length, long: lines > limit.lines || text.length > limit.chars };
}

const showAll = (lines: number, chars: number) =>
  lines > 1 ? `Show all ${lines.toLocaleString("en")} lines` : `Show all ${chars.toLocaleString("en")} characters`;

/**
 * Folds long content to a fixed height with a fade, and a toggle to show all of it. Short content renders as it is, so
 * nothing gets chrome it does not need. The full content is always in the page; folding only limits its height.
 */
export function Clamp({ text, size = "normal", children, className }: { text: string; size?: ClampSize; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const { lines, chars, long } = measure(text, size);
  if (!long) return <>{children}</>;
  return (
    <div className={className}>
      <div
        data-clamped={!open || undefined}
        className={cn(!open && ["overflow-hidden [mask-image:linear-gradient(to_bottom,black_65%,transparent)]", LIMITS[size].height])}
      >
        {children}
      </div>
      <Button variant="ghost" size="xs" className="text-muted-foreground -ml-1.5 mt-0.5" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronUp /> : <ChevronDown />}
        {open ? "Show less" : showAll(lines, chars)}
      </Button>
    </div>
  );
}
