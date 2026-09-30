"use client";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const OUTPUT_CHOICES = ["text/plain", "text/markdown", "application/json", "application/pdf"];

export interface OptionsPanelProps {
  returnImmediately: boolean;
  onReturnImmediately: (value: boolean) => void;
  historyLength: string;
  onHistoryLength: (value: string) => void;
  outputModes: string[];
  declaredOutputModes: string[];
  onOutputModes: (modes: string[]) => void;
  tasks: Array<{ taskId: string }>;
  refIds: string[];
  onRefIds: (ids: string[]) => void;
}

/** Per-request `SendMessageConfiguration`, applied to the next message only. */
export function OptionsPanel(props: OptionsPanelProps) {
  const chip = (on: boolean) =>
    cn("rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium transition-colors", on ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground");
  return (
    <div className="flex flex-col gap-5">
      <label className="flex items-start gap-3">
        <Switch checked={props.returnImmediately} onCheckedChange={props.onReturnImmediately} aria-label="returnImmediately" className="mt-0.5" />
        <span>
          <span className="block font-mono text-xs font-semibold">returnImmediately</span>
          <span className="text-muted-foreground block text-xs">Get the Task back as soon as it&apos;s created instead of waiting for it to finish or need input.</span>
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs font-semibold">historyLength</span>
        <Input value={props.historyLength} onChange={(event) => props.onHistoryLength(event.target.value)} placeholder="unset (no limit)" inputMode="numeric" className="h-8 w-40 font-mono text-xs" />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-xs font-semibold">acceptedOutputModes</span>
        <div className="flex flex-wrap gap-1.5">
          {OUTPUT_CHOICES.map((mime) => {
            const on = props.outputModes.includes(mime);
            return (
              <button
                key={mime}
                type="button"
                aria-pressed={on}
                onClick={() => props.onOutputModes(on ? props.outputModes.filter((item) => item !== mime) : [...props.outputModes, mime])}
                className={chip(on)}
              >
                {mime}
                {props.declaredOutputModes.includes(mime) && <span className="text-brand"> ★</span>}
              </button>
            );
          })}
        </div>
        <span className="text-muted-foreground text-xs">★ = declared by the Agent Card. Tap to override for this request.</span>
      </div>

      {props.tasks.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-xs font-semibold">referenceTaskIds</span>
          <div className="flex flex-wrap gap-1.5">
            {props.tasks.map((task) => {
              const on = props.refIds.includes(task.taskId);
              return (
                <button
                  key={task.taskId}
                  type="button"
                  aria-pressed={on}
                  onClick={() => props.onRefIds(on ? props.refIds.filter((id) => id !== task.taskId) : [...props.refIds, task.taskId])}
                  className={chip(on)}
                >
                  {task.taskId.slice(0, 8)}
                </button>
              );
            })}
          </div>
          <span className="text-muted-foreground text-xs">Tell the agent which earlier tasks this message builds on.</span>
        </div>
      )}
    </div>
  );
}
