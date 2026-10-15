import type { AssembledArtifact, NormalizedPart } from "../lib/types";

export interface ThreadMessage {
  /** A2A `messageId` when the wire message carried one; otherwise a UI-local id. */
  id: string;
  role: "user" | "agent";
  parts: NormalizedPart[];
  timestamp: string;
  contextId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
  /** Tasks this message referenced via `referenceTaskIds`. */
  referenceTaskIds?: string[];
  /** True when the message arrived as a task status message (`status.message`), whatever the state. */
  fromStatus?: boolean;
  /** The task state of the status that carried this message, when it came from one. */
  statusState?: string;
}

export interface StatusTransition {
  state: string;
  timestamp: string;
}

/** Per-send execution preferences (A2A `SendMessageConfiguration` + request metadata). */
export interface SendConfig {
  returnImmediately?: boolean;
  historyLength?: number;
  acceptedOutputModes?: string[];
  referenceTaskIds?: string[];
  /** Extension URIs to activate for this request. */
  extensions?: string[];
  metadata?: Record<string, unknown>;
  requestMetadata?: Record<string, unknown>;
}

/**
 * `task`: the agent created a stateful Task (has a lifecycle, artifacts).
 * `message`: the agent answered with a plain Message and no Task -- a direct reply.
 */
export type TrackedKind = "task" | "message";

export type TaskBucket = "needs-input" | "in-progress" | "completed" | "failed" | "replies";

export const MESSAGE_ONLY_STATE = "MESSAGE_ONLY";

export interface TrackedTask {
  skillId?: string;
  /** `discovered` for a task that was started outside Taskbay and then stored; absent means it was started from Taskbay. */
  origin?: "created" | "discovered";
  /** When Taskbay first stored a discovered task. */
  discoveredAt?: string;
  /** Who tracked a discovered task; null when automatic discovery found it. Only on a task's detail. */
  trackedBy?: { userId: string; name: string } | null;
  taskId: string;
  localId?: string;
  tenant?: string;
  title?: string;
  agentId: string;
  agentName: string;
  contextId?: string;
  kind?: TrackedKind;
  state: string;
  /** Status history (SUBMITTED -> WORKING -> ...), oldest first. */
  transitions?: StatusTransition[];
  createdAt: string;
  updatedAt: string;
  messages: ThreadMessage[];
  artifacts: AssembledArtifact[];
}


/** Another task in the same context (same agent, tenant and context id). */
export interface ContextSibling { localId: string; taskId: string; state: string; title?: string; updatedAt: string }

export interface DurableTaskView extends TrackedTask {
  /** Other tasks in this task's context the caller may read, newest first, at most 20. Only on a task's detail. */
  contextSiblings?: ContextSibling[];
  /** Optimistic database version; fences delayed committed snapshots in the UI. */
  version?: number;
  localId: string;
  tenant: string;
  referenceLinks: Record<string, string>;
  /** Ownership and due time, present on Tasks list rows. */
  workflow?: import("./workflow-types").WorkflowSummary | null;
}

export function taskStorageKey(task: TrackedTask): string {
  return task.localId ?? JSON.stringify([task.agentId, task.tenant ?? "", task.taskId]);
}
