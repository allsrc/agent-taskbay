"use client";

import { useState } from "react";
import { Ban, Braces, Brain, Check, ChevronDown, ChevronRight, Circle, Loader2, Wrench, X } from "lucide-react";
import { motion } from "motion/react";
import { BubblePart } from "@/components/chat/part-content";
import { AgentAvatar, StateChip } from "@/components/a2a/primitives";
import { Pill } from "@/components/patterns/status";
import { stateName, taskTitle, isActiveState } from "@/lib/task-view";
import type { AssembledArtifact, NormalizedPart } from "@/lib/types";
import type { ThreadMessage, TrackedTask } from "@/store/task-store";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PartRenderer } from "@/components/PartRenderer";
import { ContentViewer } from "@/components/content-viewer";
import { cn } from "@/lib/utils";
import { StructuredForm } from "@/components/chat/structured-form";
import { formFromPart, type FormSubmission } from "@/lib/structured-form";
import { isA2uiPart } from "@/lib/a2ui";
import { isReasoningPart, isToolPart, statusAuthor, toolPartLabel } from "@/lib/chat-activity";

const enter = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.2, ease: "easeOut" as const } };

/** Says who is speaking. Shown when the sender changes, so a run of messages from one side carries one label. */
export function SenderLabel({ who, name, id }: { who: "you" | "agent"; name: string; id: string }) {
  return who === "you" ? (
    <span className="-mb-2 self-end pr-1 text-xs font-medium text-muted-foreground">You</span>
  ) : (
    <span className="-mb-2 flex items-center gap-1.5 self-start pl-0.5 text-xs font-medium text-muted-foreground">
      <AgentAvatar name={name} id={id} size="xs" />
      {name}
    </span>
  );
}

export function UserBubble({ message }: { message: ThreadMessage }) {
  return (
    <motion.div {...enter} className="bg-brand-soft text-foreground border-brand/15 min-w-0 max-w-[92%] sm:max-w-[82%] self-end rounded-2xl rounded-br-sm border px-3.5 py-2.5">
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
      {message.parts.some(isReasoningPart) && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium">Reasoning</summary>
          <p className="mt-1 break-words whitespace-pre-wrap">{message.parts.filter(isReasoningPart).map((part) => String(part.value)).join("\n")}</p>
        </details>
      )}
      <div>
        {message.parts
          .filter((part) => !isReasoningPart(part))
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

function useActiveDisclosure(active: boolean) {
  const [manualState, setManualState] = useState<{ active: boolean; open: boolean } | null>(null);
  const open = manualState?.active === active ? manualState.open : active;
  const onOpenChange = (nextOpen: boolean) => setManualState({ active, open: nextOpen });
  return { open, onOpenChange };
}

/** A collapsed row that opens to show its payload: a tool call, a reasoning trace or another structured part. */
function StepDisclosure({ icon: Icon, label, mono = false, busy = false, children }: { icon: typeof Wrench; label: string; mono?: boolean; busy?: boolean; children: React.ReactNode }) {
  return (
    <details className="group/step min-w-0">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md py-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <Icon className="size-3.5 shrink-0" />
        <span className={cn("min-w-0 truncate", mono && "font-mono")}>{label}</span>
        {busy && <Loader2 className="size-3 shrink-0 animate-spin" />}
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-open/step:rotate-90" />
      </summary>
      <div className="mt-1.5 mb-1 min-w-0">{children}</div>
    </details>
  );
}

/** One part of a background step: plain text reads inline, tools and data open on demand, reasoning stays folded. */
function StepPart({ part, busy = false }: { part: NormalizedPart; busy?: boolean }) {
  if (isReasoningPart(part)) {
    return (
      <StepDisclosure icon={Brain} label="Reasoning">
        <p className="border-l-2 pl-2.5 text-[13px] break-words whitespace-pre-wrap text-muted-foreground italic">{String(part.value)}</p>
      </StepDisclosure>
    );
  }
  if (isToolPart(part)) {
    return (
      <StepDisclosure icon={Wrench} label={toolPartLabel(part)} mono busy={busy}>
        <PartRenderer part={part} allowRaw />
      </StepDisclosure>
    );
  }
  if (part.kind === "text" && typeof part.value === "string" && !/json/i.test(part.mediaType)) {
    return <div className="text-[13px] leading-relaxed text-foreground/80"><ContentViewer text={part.value} mediaType={part.mediaType} controls={false} /></div>;
  }
  return (
    <StepDisclosure icon={Braces} label={part.filename ?? part.mediaType ?? part.kind} mono>
      <PartRenderer part={part} allowRaw />
    </StepDisclosure>
  );
}

/** A quiet, collapsible list of background steps under one heading. Open while the task runs, folded once it ends. */
function StepLog({ icon, title, active, children }: { icon: React.ReactNode; title: string; active: boolean; children: React.ReactNode }) {
  const disclosure = useActiveDisclosure(active);
  return (
    <Collapsible open={disclosure.open} onOpenChange={disclosure.onOpenChange} className="w-full max-w-[560px] rounded-xl border bg-sunken/60">
      <CollapsibleTrigger className="group/log flex w-full items-center gap-2 rounded-xl px-3.5 py-2.5 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        {icon}
        <span className="flex-1 font-medium">{title}</span>
        <ChevronDown className="size-4 transition-transform group-data-panel-open/log:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="relative flex flex-col gap-2.5 border-t px-3.5 py-3">{children}</ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Step({ author, children }: { author?: string | null; children: React.ReactNode }) {
  return (
    <li className="flex min-w-0 gap-2.5">
      <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-border-strong" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {author && <span className="font-mono text-[11px] text-muted-foreground">{author}</span>}
        {children}
      </div>
    </li>
  );
}

/**
 * The agent's in-between status updates, folded into one quiet log so the reply, questions and results stand out.
 * Text updates read inline; tool calls, reasoning and other structured parts open to their content.
 */
export function ProgressLog({ messages, active, agentName = "Agent" }: { messages: ThreadMessage[]; active: boolean; agentName?: string }) {
  const count = `${messages.length} ${messages.length === 1 ? "update" : "updates"}`;
  return (
    <StepLog active={active} title={`${active ? "Working" : "Progress"} · ${count}`}
      icon={active ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}>
      {messages.map((message) => (
        <Step key={message.id} author={statusAuthor(message, agentName)}>
          {message.parts.length === 0 ? <span className="text-[13px] text-muted-foreground">Update</span>
            : message.parts.map((part, index) => <StepPart key={part.id ?? index} part={part} />)}
        </Step>
      ))}
    </StepLog>
  );
}

/**
 * Tool calls, results and reasoning the agent returned outside status updates. They are background work, so they fold
 * into one quiet log, newest last, and each entry opens to show its content.
 */
export function ActivityLog({ artifacts, messages = [], active }: { artifacts: AssembledArtifact[]; messages?: ThreadMessage[]; active: boolean }) {
  const entries = [
    ...messages.map((message) => ({ id: `message:${message.id}`, parts: message.parts, complete: true })),
    ...artifacts.map((artifact) => ({ id: `artifact:${artifact.artifactId}`, parts: artifact.parts, complete: artifact.complete })),
  ];
  return (
    <StepLog active={active} title={`Activity · ${entries.length} step${entries.length === 1 ? "" : "s"}`} icon={<Wrench className="size-3.5" />}>
      {entries.map((entry) => (
        <Step key={entry.id}>
          {entry.parts.map((part, index) => <StepPart key={`${entry.id}-${index}`} part={part} busy={!entry.complete} />)}
        </Step>
      ))}
    </StepLog>
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

/**
 * The outcome of a task, set apart from the conversation. A text result reads like prose (formatted when it is Markdown);
 * other parts render as tables, trees, media or downloads.
 */
export function ArtifactCard({ artifact }: { artifact: AssembledArtifact }) {
  const textParts = artifact.parts.filter((part) => part.kind === "text");
  const otherParts = artifact.parts.filter((part) => part.kind !== "text");
  const title = artifact.name && artifact.name !== artifact.artifactId ? artifact.name : null;
  return (
    <motion.section {...enter} aria-label="Result" className="flex w-full flex-col gap-3 rounded-2xl border border-brand/30 bg-card p-4 shadow-elevated">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="brand">Result</Pill>
        {title ? <h3 className="min-w-0 flex-1 truncate font-heading text-[15px] font-semibold">{title}</h3> : <span className="flex-1" />}
        <StateChip state={artifact.complete ? "COMPLETED" : "WORKING"} />
      </div>
      {artifact.description && <p className="text-muted-foreground -mt-1 text-xs">{artifact.description}</p>}
      {textParts.length > 0 && (
        <div className="flex flex-col gap-3 text-sm leading-relaxed">
          {textParts.map((part, index) => <ContentViewer key={part.id ?? index} text={String(part.value)} mediaType={part.mediaType} streaming={!artifact.complete && index === textParts.length - 1} />)}
        </div>
      )}
      {!artifact.complete && textParts.length === 0 && (
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin" /> Streaming…
        </div>
      )}
      {otherParts.map((part, index) => (
        <PartRenderer key={`${artifact.artifactId}-${index}`} part={part} />
      ))}
    </motion.section>
  );
}
