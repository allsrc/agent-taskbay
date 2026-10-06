import type { DurableTaskView } from "../../../shared/task-types";
import type { DecisionRisk, ProposedAction } from "../../domain/decision-model";

/** ADR 0023: an agent that advertises this extension may ask for an approval inside its INPUT_REQUIRED message. */
export const APPROVAL_REQUEST_EXTENSION_URI = "https://extensions.allsrc.dev/agent-taskbay/approval-request/v1";
export const APPROVAL_REQUEST_MEDIA_TYPE = "application/vnd.agent-taskbay.approval-request+json";

/** Agents propose a lifetime; the console bounds it so an agent cannot hold a request open indefinitely. */
export const AGENT_REQUEST_LIFETIME = { defaultMs: 24 * 3_600_000, minMs: 5 * 60_000, maxMs: 7 * 24 * 3_600_000 } as const;
const MAX_PART_BYTES = 128 * 1024;

export interface AgentApprovalRequest { title: string; summary: string; risk: DecisionRisk; action: ProposedAction; lifetimeMs: number }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Shape check only: the action's content is validated again by the decision service (`validateAction`) before anything is
 * written, so an agent cannot store content a person could not have proposed. Anything malformed is ignored and the part
 * stays ordinary message content.
 */
export function parseAgentApprovalRequest(value: unknown): AgentApprovalRequest | undefined {
  if (!isObject(value)) return undefined;
  try { if (JSON.stringify(value).length > MAX_PART_BYTES) return undefined; } catch { return undefined; }
  const { title, summary, risk, expiresInSeconds, action } = value;
  if (typeof title !== "string" || !title.trim() || title.length > 300) return undefined;
  if (summary !== undefined && (typeof summary !== "string" || summary.length > 4000)) return undefined;
  if (risk !== undefined && !["low", "medium", "high"].includes(risk as string)) return undefined;
  if (expiresInSeconds !== undefined && (typeof expiresInSeconds !== "number" || !Number.isFinite(expiresInSeconds))) return undefined;
  if (!isObject(action)) return undefined;
  let proposed: ProposedAction;
  if (action.kind === "send_message" && typeof action.text === "string" && (action.data === undefined || isObject(action.data)))
    proposed = { kind: "send_message", text: action.text, ...(action.data ? { data: action.data as Record<string, never> } : {}) };
  else if (action.kind === "send_data" && isObject(action.form) && isObject(action.values))
    proposed = { kind: "send_data", form: action.form as Record<string, never>, values: action.values as Record<string, string | number | boolean> };
  else return undefined;
  const lifetimeMs = expiresInSeconds === undefined ? AGENT_REQUEST_LIFETIME.defaultMs
    : Math.min(AGENT_REQUEST_LIFETIME.maxMs, Math.max(AGENT_REQUEST_LIFETIME.minMs, Math.floor(expiresInSeconds * 1000)));
  return { title: title.trim(), summary: typeof summary === "string" ? summary : "", risk: (risk as DecisionRisk | undefined) ?? "medium", action: proposed, lifetimeMs };
}

/** The approval request in the task's latest input request, if the agent sent one. Only the latest request can open one. */
export function findAgentApprovalRequest(view: DurableTaskView): { messageId: string; request: AgentApprovalRequest } | undefined {
  if (view.kind === "message" || view.state.replace("TASK_STATE_", "") !== "INPUT_REQUIRED") return undefined;
  const prompt = view.messages.filter((message) => message.role === "agent" && message.fromStatus).at(-1);
  if (!prompt) return undefined;
  for (const part of prompt.parts) {
    if (part.kind !== "data" || part.mediaType !== APPROVAL_REQUEST_MEDIA_TYPE) continue;
    const request = parseAgentApprovalRequest(part.value);
    if (request) return { messageId: prompt.id, request };
  }
  return undefined;
}
