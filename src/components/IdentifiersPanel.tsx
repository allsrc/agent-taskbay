"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import type { TrackedTask } from "@/store/task-store";

/** The IDs that A2A keeps separate, each with the scope it identifies. */
export function IdentifiersPanel({ task }: { task: TrackedTask }) {
  const isTask = task.kind !== "message";
  const rows: Array<{ label: string; hint: string; values: string[] }> = [
    { label: "contextId", hint: "Conversation this belongs to", values: task.contextId ? [task.contextId] : [] },
    ...(isTask ? [{ label: "taskId", hint: "This unit of work", values: [task.taskId] }] : []),
    {
      label: "messageId",
      hint: "Individual turns",
      values: task.messages.map((message) => message.id),
    },
    {
      label: "artifactId",
      hint: "Outputs produced",
      values: task.artifacts.map((artifact) => artifact.artifactId),
    },
  ];

  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value).then(() => toast.success("Copied"), () => toast.error("Copy failed"));
  };

  return (
    <dl className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.label}>
          <dt className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-xs font-semibold">{row.label}</span>
            <span className="text-muted-foreground text-[11px]">{row.hint}</span>
          </dt>
          <dd className="mt-1 flex flex-col gap-0.5">
            {row.values.length ? (
              row.values.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => copy(value)}
                  title="Copy"
                  className="text-muted-foreground hover:text-foreground group flex items-center justify-between gap-2 text-left font-mono text-[11px]"
                >
                  <span className="truncate">{value}</span>
                  <Copy className="size-3 shrink-0 opacity-0 group-hover:opacity-100" />
                </button>
              ))
            ) : (
              <span className="text-muted-foreground font-mono text-[11px]">—</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
