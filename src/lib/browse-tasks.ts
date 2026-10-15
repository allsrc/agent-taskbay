/** The query for the browse route: only filters that are set are sent. */
export interface BrowseFilters { tenant?: string; contextId?: string; status?: string; pageToken?: string; pageSize?: number }

export function browseUrl(agentId: string, filters: BrowseFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") params.set(key, String(value));
  const query = params.toString();
  return `/api/agents/${encodeURIComponent(agentId)}/remote-tasks${query ? `?${query}` : ""}`;
}

export const BROWSE_STATUS_OPTIONS = [
  { value: "", label: "Any state" },
  { value: "TASK_STATE_INPUT_REQUIRED", label: "Needs input" },
  { value: "TASK_STATE_AUTH_REQUIRED", label: "Needs authorization" },
  { value: "TASK_STATE_WORKING", label: "Working" },
  { value: "TASK_STATE_COMPLETED", label: "Completed" },
  { value: "TASK_STATE_FAILED", label: "Failed" },
] as const;

/** The modes of task discovery, in the words the console uses. */
export const DISCOVERY_MODES = [
  { value: "browse", label: "Browse only", help: "People with access to the whole agent can look at the tasks other systems started and choose to track them. Nothing is stored until a task is tracked." },
  { value: "auto", label: "Automatic", help: "Taskbay also stores and follows tasks other systems started, in the background." },
  { value: "off", label: "Off", help: "Taskbay never lists this agent's tasks." },
] as const;
export type DiscoveryModeValue = (typeof DISCOVERY_MODES)[number]["value"];
/** Automatic discovery arrives with its background sweep; until then the option is not offered. */
export const AUTOMATIC_DISCOVERY_AVAILABLE = false;
const MODE_RANK: Record<DiscoveryModeValue, number> = { off: 0, browse: 1, auto: 2 };
export const modeAllowedByCap = (mode: DiscoveryModeValue, cap: DiscoveryModeValue) => MODE_RANK[mode] <= MODE_RANK[cap];

/** What the discovery status route returns. */
export interface DiscoveryStatusView {
  mode: DiscoveryModeValue;
  effectiveMode: DiscoveryModeValue;
  cap: DiscoveryModeValue;
  historyDays: number;
  pausedReason: string | null;
  listing: "supported" | "unsupported" | "unknown";
  auto: { lastCheckedAt: string | null; lastFullSweepAt: string | null; foundTotal: number } | null;
  canBrowse: boolean;
}

/** A row the browse route returned (display data only). */
export interface BrowseRowView {
  taskId: string;
  contextId: string | null;
  state: string;
  updatedAt: string | null;
  title: string | null;
  snippet: string | null;
  tracked: boolean;
  localId: string | null;
}
