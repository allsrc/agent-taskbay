"use client";

import { useEffect, useRef } from "react";

export interface WireEntry {
  id: number;
  title: string;
  json: unknown;
}

/** The `{ } Wire` inspector: what this client sent and every A2A event that came back. */
export function WirePanel({ entries }: { entries: WireEntry[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [entries.length]);
  return (
    <div className="bg-inset border-border max-h-44 shrink-0 overflow-auto border-t px-4 py-2.5 md:px-6">
      {entries.length === 0 && <p className="text-muted-foreground font-mono text-xs">{"// nothing sent yet"}</p>}
      {entries.map((entry) => (
        <div key={entry.id} className="mb-2">
          <div className="text-brand mb-1 font-mono text-[11px] font-medium">{entry.title}</div>
          <pre className="text-muted-foreground font-mono text-xs leading-normal whitespace-pre-wrap">{JSON.stringify(entry.json, null, 1)}</pre>
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}
