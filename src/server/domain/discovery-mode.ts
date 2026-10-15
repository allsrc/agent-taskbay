/**
 * How Taskbay finds tasks that were started outside it.
 * - `off`: never lists the agent's tasks.
 * - `browse`: lists them live when a person asks; stores a task only when a person tracks it.
 * - `auto`: also stores and follows them in the background.
 */
export type TaskDiscoveryMode = "off" | "browse" | "auto";
export const TASK_DISCOVERY_MODES: readonly TaskDiscoveryMode[] = ["off", "browse", "auto"];
export const DEFAULT_TASK_DISCOVERY_MODE: TaskDiscoveryMode = "browse";
export const DEFAULT_TASK_DISCOVERY_HISTORY_DAYS = 7;
export const MAX_TASK_DISCOVERY_HISTORY_DAYS = 90;

const rank: Record<TaskDiscoveryMode, number> = { off: 0, browse: 1, auto: 2 };

/** The mode that applies: an agent's own mode, lowered (never raised) by the deployment-wide cap. */
export function effectiveTaskDiscovery(agentMode: TaskDiscoveryMode, cap: TaskDiscoveryMode): TaskDiscoveryMode {
  return rank[agentMode] <= rank[cap] ? agentMode : cap;
}

export const isTaskDiscoveryMode = (value: unknown): value is TaskDiscoveryMode =>
  typeof value === "string" && (TASK_DISCOVERY_MODES as readonly string[]).includes(value);

/** Where a stored task came from: started from Taskbay, or found on the agent (tracked by a person or by automatic discovery). */
export type TaskOrigin = "created" | "discovered";
