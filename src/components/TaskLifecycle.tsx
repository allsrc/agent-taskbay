import { Check, Circle, KeyRound, UserRound, X } from "lucide-react";
import type { StatusTransition } from "@/store/task-store";
import { cn } from "@/lib/utils";

const bare = (state: string) => state.replace("TASK_STATE_", "");
export const stateLabel = (state: string) => bare(state).toLowerCase().replaceAll("_", " ");

const TERMINAL = ["COMPLETED", "FAILED", "CANCELED", "REJECTED"];
const HAPPY_PATH = ["SUBMITTED", "WORKING", "COMPLETED"] as const;

/** The A2A task state machine, with the task's current position highlighted. */
export function TaskLifecycle({ state, transitions = [] }: { state: string; transitions?: StatusTransition[] }) {
  const current = bare(state);
  const visited = new Set(transitions.map((item) => bare(item.state)));
  const interrupted = current === "INPUT_REQUIRED" || current === "AUTH_REQUIRED";
  const endState = TERMINAL.includes(current) ? current : "COMPLETED";
  const path = [HAPPY_PATH[0], HAPPY_PATH[1], endState];

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-0">
        {path.map((step, index) => {
          const active = step === current;
          const reached = visited.has(step) || active;
          const failed = active && ["FAILED", "CANCELED", "REJECTED"].includes(step);
          return (
            <li key={step} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full border text-[10px]",
                    failed && "border-destructive bg-destructive/10 text-destructive",
                    !failed && reached && "border-primary bg-primary text-primary-foreground",
                    !reached && "border-border text-muted-foreground",
                    active && !failed && !TERMINAL.includes(step) && "ring-primary/30 ring-4",
                  )}
                >
                  {failed ? <X className="size-3" /> : (reached && !active) || (active && step === "COMPLETED") ? <Check className="size-3" /> : <Circle className="size-1.5 fill-current" />}
                </span>
                {index < path.length - 1 && <span className={cn("h-5 w-px", reached && visited.has(path[index + 1]) ? "bg-primary" : "bg-border")} />}
              </div>
              <span className={cn("-mt-0.5 text-sm", active ? "font-semibold" : reached ? "" : "text-muted-foreground")}>
                {stateLabel(step)}
              </span>
            </li>
          );
        })}
      </ol>

      {(interrupted || visited.has("INPUT_REQUIRED") || visited.has("AUTH_REQUIRED")) && (
        <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-xs", interrupted ? "border-warning/40 bg-warning/10 text-warning" : "border-border text-muted-foreground")}>
          {current === "AUTH_REQUIRED" || (!interrupted && visited.has("AUTH_REQUIRED")) ? <KeyRound className="size-3.5" /> : <UserRound className="size-3.5" />}
          {interrupted
            ? current === "AUTH_REQUIRED" ? "Paused: the agent needs you to authenticate" : "Paused: the agent needs your input"
            : "Was paused for human input earlier"}
        </div>
      )}

      {transitions.length > 0 && (
        <div>
          <p className="text-muted-foreground mb-1.5 text-[11px] font-semibold tracking-wide uppercase">Status history</p>
          <ul className="flex flex-col gap-1">
            {[...transitions].reverse().map((item, index) => (
              <li key={`${item.state}-${item.timestamp}-${index}`} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="font-medium">{stateLabel(item.state)}</span>
                <time className="text-muted-foreground font-mono text-[11px]">{new Date(item.timestamp).toLocaleTimeString()}</time>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
