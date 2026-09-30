"use client";

import { Ban, Check, Circle, Loader2, X } from "lucide-react";
import { motion } from "motion/react";
import { BubblePart } from "@/components/chat/part-content";
import { StateChip } from "@/components/a2a/primitives";
import { stateName, taskTitle, isActiveState } from "@/lib/task-view";
import type { AssembledArtifact } from "@/lib/types";
import type { ThreadMessage, TrackedTask } from "@/store/task-store";
import { Button } from "@/components/ui/button";
import { PartRenderer } from "@/components/PartRenderer";
import { cn } from "@/lib/utils";

const enter = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.2, ease: "easeOut" as const } };

export function UserBubble({ message }: { message: ThreadMessage }) {
  return (
    <motion.div {...enter} className="bg-primary text-primary-foreground max-w-[82%] self-end rounded-[14px_14px_4px_14px] px-3.5 py-2.5">
      {message.parts.map((part, index) => (
        <BubblePart key={index} part={part} onUser />
      ))}
    </motion.div>
  );
}

/** Extracts `options` / `choices` string lists an agent may attach as a data part, rendered as quick replies. */
function quickReplies(message: ThreadMessage): string[] {
  for (const part of message.parts) {
    if (part.kind !== "data" || !part.value || typeof part.value !== "object") continue;
    const value = part.value as Record<string, unknown>;
    const list = value.options ?? value.choices;
    if (Array.isArray(list) && list.every((item) => typeof item === "string")) return list as string[];
  }
  return [];
}

export function AgentBubble({
  message,
  taskState,
  onReply,
}: {
  message: ThreadMessage;
  /** State of the task this message belongs to; drives the amber / purple prompt styling. */
  taskState?: string;
  onReply?: (text: string) => void;
}) {
  const state = taskState ? stateName(taskState) : "";
  const prompt = message.fromStatus && (state === "INPUT_REQUIRED" || state === "AUTH_REQUIRED") ? state : null;
  const options = prompt === "INPUT_REQUIRED" ? quickReplies(message) : [];
  return (
    <motion.div
      {...enter}
      className={cn(
        "bg-popover flex max-w-[82%] flex-col gap-2.5 self-start rounded-[14px_14px_14px_4px] border px-3.5 py-2.5",
        prompt === "INPUT_REQUIRED" ? "border-warning" : prompt === "AUTH_REQUIRED" ? "border-auth" : "border-border",
      )}
    >
      {prompt && <span className={cn("font-mono text-[11px] font-medium", prompt === "INPUT_REQUIRED" ? "text-warning" : "text-auth")}>{prompt}</span>}
      <div>
        {message.parts.map((part, index) => (
          <BubblePart key={index} part={part} />
        ))}
      </div>
      {options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {options.map((option, index) => (
            <button
              key={option}
              type="button"
              onClick={() => onReply?.(option)}
              className={cn(
                "rounded-lg px-4 py-2 font-mono text-[13px] font-semibold transition-opacity hover:opacity-90",
                index === 0 ? "bg-warning text-warning-foreground" : "border-warning text-warning border",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      )}
      {prompt === "AUTH_REQUIRED" && (
        <p className="text-muted-foreground text-xs">
          Complete the authorization the agent asked for, then reply here to resume. In-app credential exchange is not built yet.
        </p>
      )}
    </motion.div>
  );
}

function stepsFor(task: TrackedTask): Array<{ label: string; status: "done" | "active" | "blocked" | "failed" | "todo" }> {
  const current = stateName(task.state);
  const seen = (task.transitions ?? []).map((item) => stateName(item.state));
  const order = ["SUBMITTED", "WORKING"];
  for (const state of seen) if (!order.includes(state) && state !== "COMPLETED" && !["FAILED", "CANCELED", "REJECTED"].includes(state)) order.push(state);
  if (!order.includes(current) && !["COMPLETED", "FAILED", "CANCELED", "REJECTED"].includes(current)) order.push(current);
  const end = ["FAILED", "CANCELED", "REJECTED"].includes(current) ? current : "COMPLETED";
  order.push(end);
  const currentIndex = order.indexOf(current);
  return order.map((state, index) => {
    const label = state.toLowerCase().replaceAll("_", " ");
    if (index === currentIndex) {
      if (state === "COMPLETED") return { label, status: "done" as const };
      if (["FAILED", "CANCELED", "REJECTED"].includes(state)) return { label, status: "failed" as const };
      if (state === "INPUT_REQUIRED" || state === "AUTH_REQUIRED") return { label, status: "blocked" as const };
      return { label, status: "active" as const };
    }
    return { label, status: index < currentIndex ? ("done" as const) : ("todo" as const) };
  });
}

export function TaskCard({ task, canceling, onCancel }: { task: TrackedTask; canceling: boolean; onCancel: () => void }) {
  const state = stateName(task.state);
  return (
    <motion.section
      id={`task-${task.taskId}`}
      {...enter}
      className="bg-card border-border flex w-full max-w-[560px] scroll-mt-16 flex-col gap-2.5 rounded-[14px] border p-3.5"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="min-w-0 flex-1 truncate font-mono text-[15px] font-bold">{taskTitle(task, 48)}</h3>
        <StateChip state={task.state} />
      </div>
      <div className="text-muted-foreground flex items-center gap-2 font-mono text-[11px]">
        <span className="min-w-0 flex-1 truncate">
          {task.taskId.slice(0, 13)} · {task.contextId ? task.contextId.slice(0, 13) : "no context"}
        </span>
        {isActiveState(task.state) && (
          <Button variant="ghost" size="sm" className="text-muted-foreground h-6 px-2 text-[11px]" onClick={onCancel} disabled={canceling}>
            {canceling ? <Loader2 className="animate-spin" /> : <Ban />} Cancel
          </Button>
        )}
      </div>
      <ol className="flex flex-col gap-1.5">
        {stepsFor(task).map((step) => (
          <li
            key={step.label}
            className={cn(
              "flex items-center gap-2.5 text-sm",
              step.status === "done" && "text-success",
              step.status === "active" && "text-primary",
              step.status === "blocked" && (state === "AUTH_REQUIRED" ? "text-auth" : "text-warning"),
              step.status === "failed" && "text-brand",
              step.status === "todo" && "text-muted-foreground",
            )}
          >
            <span className={cn("flex w-4 justify-center", step.status === "active" && "animate-pulse-soft")}>
              {step.status === "done" ? <Check className="size-3.5" /> : step.status === "failed" ? <X className="size-3.5" /> : step.status === "blocked" ? <span className="font-mono">!</span> : step.status === "active" ? <span className="text-[10px]">●</span> : <Circle className="size-3" />}
            </span>
            <span className="capitalize">{step.label}</span>
          </li>
        ))}
      </ol>
    </motion.section>
  );
}

export function ArtifactCard({ artifact }: { artifact: AssembledArtifact }) {
  const textParts = artifact.parts.filter((part) => part.kind === "text");
  const otherParts = artifact.parts.filter((part) => part.kind !== "text");
  return (
    <motion.section {...enter} className="bg-card border-border flex w-full max-w-[560px] flex-col gap-2 rounded-[14px] border p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label-mono normal-case">ARTIFACT</span>
        <h3 className="min-w-0 flex-1 truncate font-mono text-sm font-bold">{artifact.name ?? artifact.artifactId}</h3>
        <StateChip state={artifact.complete ? "COMPLETED" : "WORKING"} />
      </div>
      {artifact.description && <p className="text-muted-foreground text-xs">{artifact.description}</p>}
      {textParts.length > 0 && (
        <div className="bg-background min-h-20 rounded-lg p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap">
          {textParts.map((part) => String(part.value)).join("")}
          {!artifact.complete && <span className="text-brand animate-caret">▌</span>}
        </div>
      )}
      {!artifact.complete && textParts.length === 0 && (
        <div className="text-muted-foreground flex items-center gap-2 font-mono text-xs">
          <Loader2 className="size-3.5 animate-spin" /> streaming…
        </div>
      )}
      {otherParts.map((part, index) => (
        <PartRenderer key={`${artifact.artifactId}-${index}`} part={part} />
      ))}
    </motion.section>
  );
}
