import type { AgentRecord, JsonValue } from "../../domain/persistence-model";

/** Reads the tasks an agent has, with the agent's own credential. Nothing here stores anything. */
export interface RemoteTaskGateway {
  /** One page of the agent's tasks. Throws `ListTasksUnsupported` when the agent cannot list tasks. */
  list(agent: AgentRecord, query: RemoteTaskQuery): Promise<{ tasks: JsonValue[]; nextPageToken: string }>;
  /** One task, as the `{ task }` event the observer stores. Throws `RemoteRejection` (for example `task_not_found`). */
  get(agent: AgentRecord, tenant: string, taskId: string): Promise<JsonValue>;
}

export interface RemoteTaskQuery {
  tenant: string;
  contextId?: string;
  /** An A2A task state name such as `TASK_STATE_INPUT_REQUIRED`. */
  status?: string;
  pageToken?: string;
  pageSize: number;
}

/** A refusal by Taskbay (not by the agent) to browse or track. `kind` selects the console's words. */
export class DiscoveryError extends Error {
  constructor(message: string, readonly status: number, readonly kind: string) { super(message); this.name = "DiscoveryError"; }
}
