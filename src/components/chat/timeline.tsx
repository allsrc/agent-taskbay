"use client";

import { Ban, Check, ChevronDown, Circle, Loader2, Wrench, X } from "lucide-react";
import { motion } from "motion/react";
import { BubblePart } from "@/components/chat/part-content";
import { StateChip } from "@/components/a2a/primitives";
import { Pill } from "@/components/patterns/status";
import { stateName, taskTitle, isActiveState } from "@/lib/task-view";
import type { AssembledArtifact } from "@/lib/types";
import type { ThreadMessage, TrackedTask } from "@/store/task-store";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PartRenderer } from "@/components/PartRenderer";
import { cn } from "@/lib/utils";
import { StructuredForm } from "@/components/chat/structured-form";
import { formFromPart, type FormSubmission } from "@/lib/structured-form";
import { isA2uiPart } from "@/lib/a2ui";
import { activityLabel } from "@/lib/chat-activity";

const enter = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.2, ease: "easeOut" as const } };

export function UserBubble({ message }: { message: ThreadMessage }) {
  return (
    <motion.div {...enter} className="bg-primary text-primary-foreground max-w-[92%] sm:max-w-[82%] self-end rounded-2xl rounded-br-sm px-3.5 py-2.5">
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
  extensions = [],
  onSubmitForm,
  answered = false,
  a2ui = false,
}: {
  message: ThreadMessage;
  /** State of the task this message belongs to; drives the amber / purple prompt styling. */
  taskState?: string;
  onReply?: (text: string) => void;
  /** Extension URIs the agent advertises; a structured form renders only when it opted in. */
  extensions?: readonly string[];
  onSubmitForm?: (submission: FormSubmission) => void | Promise<void>;
  /** The form was already answered or the task no longer waits, so the form is shown read-only as data. */
  answered?: boolean;
  /** The agent advertises A2UI: its interface parts render as surfaces, so the bubble only notes them. */
  a2ui?: boolean;
}) {
  const state = taskState ? stateName(taskState) : "";
  const prompt = message.fromStatus && (state === "INPUT_REQUIRED" || state === "AUTH_REQUIRED") ? state : null;
  const options = prompt === "INPUT_REQUIRED" ? quickReplies(message) : [];
  // Unrecognized or unadvertised forms stay ordinary data parts, so the generic composer remains the fallback.
  const formPart = prompt === "INPUT_REQUIRED" && !answered && onSubmitForm
    ? message.parts.map((part) => ({ part, form: formFromPart(part, extensions) })).find((entry) => entry.form)
    : undefined;
  return (
    <motion.div
      {...enter}
      className={cn(
        "bg-popover flex max-w-[92%] sm:max-w-[82%] flex-col gap-2.5 self-start rounded-2xl rounded-bl-sm border px-3.5 py-2.5",
        prompt === "INPUT_REQUIRED" ? "border-warning" : prompt === "AUTH_REQUIRED" ? "border-info" : "border-border",
      )}
    >
      {prompt && <span><Pill tone={prompt === "INPUT_REQUIRED" ? "warning" : "info"} dot>{prompt === "INPUT_REQUIRED" ? "Input required" : "Authorization required"}</Pill></span>}
      <div>
        {message.parts
          // The options list is shown as buttons below; don't echo it as raw JSON too.
          .filter((part) => !(options.length > 0 && part.kind === "data") && part !== formPart?.part)
          .map((part, index) => a2ui && isA2uiPart(part)
            ? <span key={index} className="text-muted-foreground mt-1 block font-mono text-[11px]">Interface update (shown below)</span>
            : <BubblePart key={index} part={part} />)}
      </div>
      {formPart?.form && <StructuredForm form={formPart.form} onSubmit={onSubmitForm!} />}
      {options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {options.map((option, index) => (
            <button
              key={option}
              type="button"
              onClick={() => onReply?.(option)}
              className={cn(
                "rounded-lg px-4 py-2 font-mono text-[13px] font-semibold transition-opacity hover:opacity-90",
                index === 0 ? "bg-warning text-background" : "border-warning/60 text-warning border",
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

/** Short text for one in-between update; non-text parts show their kind. */
function updateText(message: ThreadMessage): string {
  const text = message.parts.map((part) => (part.kind === "text" ? String(part.value) : `[${part.kind}]`)).join(" ").trim();
  return text || "Update";
}

/**
 * The agent's in-between status updates, folded into one quiet log so the final answer and the result stand out.
 * Open while the task is running, folded once it has finished.
 */
export function ProgressLog({ messages, active }: { messages: ThreadMessage[]; active: boolean }) {
  return (
    <Collapsible defaultOpen={active} className="w-full max-w-[560px] rounded-xl border bg-sunken/60">
      <CollapsibleTrigger className="group/log flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-xs text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-xl">
        {active ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        <span className="flex-1 font-medium">
          {active ? "Working" : "Progress"} · {messages.length} update{messages.length === 1 ? "" : "s"}
        </span>
        <ChevronDown className="size-4 transition-transform group-data-panel-open/log:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="space-y-2 border-t px-3.5 py-3">
          {messages.map((message) => (
            <li key={message.id} className="flex gap-2.5 text-[13px] text-muted-foreground">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong" aria-hidden />
              <span className="min-w-0 break-words whitespace-pre-wrap">{updateText(message)}</span>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Tool calls and results the agent returned as structured data. They are background work, so they fold into one
 * quiet log, newest last, and each entry opens to show its JSON. Open while the task runs, folded once it finishes.
 */
export function ActivityLog({ artifacts, active }: { artifacts: AssembledArtifact[]; active: boolean }) {
  return (
    <Collapsible defaultOpen={active} className="w-full max-w-[560px] rounded-xl border bg-sunken/60">
      <CollapsibleTrigger className="group/log flex w-full items-center gap-2 rounded-xl px-3.5 py-2.5 text-left text-xs text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <Wrench className="size-3.5" />
        <span className="flex-1 font-medium">
          Activity · {artifacts.length} tool {artifacts.length === 1 ? "result" : "results"}
        </span>
        <ChevronDown className="size-4 transition-transform group-data-panel-open/log:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="divide-y border-t">
          {artifacts.map((artifact) => (
            <li key={artifact.artifactId}>
              <details className="group/entry px-3.5 py-2">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] text-muted-foreground">
                  <span className="size-1.5 shrink-0 rounded-full bg-border-strong" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{activityLabel(artifact)}</span>
                  {!artifact.complete && <Loader2 className="size-3 animate-spin" />}
                  <ChevronDown className="size-3.5 transition-transform group-open/entry:rotate-180" />
                </summary>
                <div className="mt-2 space-y-2">
                  {artifact.parts.map((part, index) => (
                    <PartRenderer key={`${artifact.artifactId}-${index}`} part={part} />
                  ))}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function TaskCard({ task, canceling, onCancel }: { task: TrackedTask; canceling: boolean; onCancel: () => void }) {
  const state = stateName(task.state);
  return (
    <motion.section
      id={`task-${task.taskId}`}
      {...enter}
      className="bg-card border-border flex w-full max-w-[560px] scroll-mt-16 flex-col gap-2.5 rounded-xl border p-3.5"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="min-w-0 flex-1 truncate font-heading text-[15px] font-semibold">{taskTitle(task, 48)}</h3>
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
              step.status === "active" && "text-brand-text",
              step.status === "blocked" && (state === "AUTH_REQUIRED" ? "text-info" : "text-warning"),
              step.status === "failed" && "text-danger",
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
  // A text-only artifact is the agent's answer, so it reads like a chat reply rather than a data card.
  if (textParts.length > 0 && otherParts.length === 0) {
    const caption = artifact.name && artifact.name !== artifact.artifactId ? artifact.name : null;
    return (
      <motion.section {...enter} aria-label="Result" className="flex max-w-[92%] flex-col gap-1.5 self-start rounded-2xl rounded-bl-sm border bg-popover px-3.5 py-2.5 sm:max-w-[82%]">
        {caption && <span className="text-xs font-medium text-muted-foreground">{caption}</span>}
        <div>
          {textParts.map((part) => <BubblePart key={part.id} part={part} />)}
          {!artifact.complete && <span className="text-brand-text animate-caret">▌</span>}
        </div>
      </motion.section>
    );
  }
  return (
    <motion.section {...enter} className="flex w-full flex-col gap-3 rounded-2xl border border-brand/40 bg-card p-4 shadow-elevated">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="brand">Result</Pill>
        <h3 className="min-w-0 flex-1 truncate font-heading text-base font-semibold">{artifact.name ?? artifact.artifactId}</h3>
        <StateChip state={artifact.complete ? "COMPLETED" : "WORKING"} />
      </div>
      {artifact.description && <p className="text-muted-foreground text-xs">{artifact.description}</p>}
      {textParts.length > 0 && (
        <div className="bg-background min-h-20 rounded-lg border p-4 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap">
          {textParts.map((part) => String(part.value)).join("")}
          {!artifact.complete && <span className="text-brand-text animate-caret">▌</span>}
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
