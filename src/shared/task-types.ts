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
  /** True when this message is the agent's question/prompt attached to an INPUT_REQUIRED / AUTH_REQUIRED status. */
  fromStatus?: boolean;
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


export interface DurableTaskView extends TrackedTask {
  /** Optimistic database version; fences delayed committed snapshots in the UI. */
  version?: number;
  localId: string;
  tenant: string;
  referenceLinks: Record<string, string>;
}

export function taskStorageKey(task: TrackedTask): string {
  return task.localId ?? JSON.stringify([task.agentId, task.tenant ?? "", task.taskId]);
}
