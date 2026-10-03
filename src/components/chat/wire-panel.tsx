"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { StateChip } from "@/components/a2a/primitives";
import { buildSequence, type RowTone, type SequenceRow, type WireEntry } from "@/lib/wire-sequence";
import { cn } from "@/lib/utils";

export type { WireEntry };

const DOT: Record<RowTone, string> = {
  send: "bg-primary",
  state: "bg-muted-foreground",
  artifact: "bg-success",
  message: "bg-foreground",
  cancel: "bg-brand",
};

const seconds = (ms: number) => (ms < 1000 ? `+${ms}ms` : `+${(ms / 1000).toFixed(1)}s`);

function Row({ row, agentName }: { row: SequenceRow; agentName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.li layout initial={{ opacity: 0, x: row.dir === "out" ? -8 : 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }} className="relative pl-6">
      <span className={cn("ring-background absolute top-2 left-0 size-2.5 rounded-full ring-4", DOT[row.tone])} />
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="hover:bg-accent/60 flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors"
      >
        <ChevronRight className={cn("text-muted-foreground mt-1 size-3 shrink-0 transition-transform", open && "rotate-90")} />
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground flex items-center gap-1.5 font-mono text-[10px]">
            <span>{row.dir === "out" ? `You → ${agentName}` : `${agentName} → You`}</span>
            <span className="ml-auto">{row.dir === "out" ? "t0" : seconds(row.offset)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[13px] font-semibold">{row.label}</span>
            {row.state && <StateChip state={row.state} />}
            {row.count > 1 && <span className="text-muted-foreground font-mono text-[11px]">× {row.count} chunks</span>}
          </div>
          {row.detail && <div className="text-muted-foreground line-clamp-2 text-xs">{row.detail}</div>}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.pre
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-inset border-border text-muted-foreground mt-1 mb-1.5 max-h-64 overflow-auto rounded-lg border p-2.5 font-mono text-[11px] leading-normal whitespace-pre-wrap"
          >
            {JSON.stringify(row.json, null, 1)}
          </motion.pre>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

/** The `{ } Wire` view as a request/response sequence: each send opens a numbered turn and its events follow in order. */
export function SequencePanel({ entries, agentName }: { entries: WireEntry[]; agentName: string }) {
  const turns = buildSequence(entries);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [entries.length]);

  if (turns.length === 0) {
    return (
      <div className="text-muted-foreground m-auto max-w-56 py-10 text-center text-sm">
        Send a message and the A2A exchange appears here, step by step: the request, then each task, status and artifact event.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {turns.map((turn) => (
        <section key={turn.turn}>
          <h3 className="label-mono mb-2 flex items-center gap-2">
            <span className="bg-secondary rounded px-1.5 py-0.5 normal-case">#{turn.turn}</span>
            {turn.title}
            <span className="ml-auto normal-case">{new Date(turn.startedAt).toLocaleTimeString()}</span>
          </h3>
          <ol className="before:bg-border relative flex flex-col before:absolute before:top-3 before:bottom-3 before:left-[4px] before:w-px">
            {turn.rows.map((row) => (
              <Row key={row.id} row={row} agentName={agentName} />
            ))}
          </ol>
        </section>
      ))}
      <div ref={end} />
    </div>
  );
}
