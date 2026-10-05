import type { DecisionExecutionView, DecisionOutcome, DecisionRisk, DecisionStatus, ExecutionStatus } from "@/shared/decision-types";
import { stateName } from "./task-view";

export const STATUS_LABEL: Record<DecisionStatus, string> = {
  pending: "Pending", approved: "Approved", rejected: "Rejected", changes_requested: "Changes requested",
  expired: "Expired", superseded: "Superseded",
};
export const STATUS_TONE: Record<DecisionStatus, string> = {
  pending: "text-warning bg-warning/15", approved: "text-success bg-success/15", rejected: "text-brand bg-brand/15",
  changes_requested: "text-auth bg-auth/15", expired: "text-muted-foreground bg-muted-foreground/15", superseded: "text-muted-foreground bg-muted-foreground/15",
};
export const RISK_TONE: Record<DecisionRisk, string> = { low: "text-success bg-success/15", medium: "text-warning bg-warning/15", high: "text-brand bg-brand/15" };
export const OUTCOME_LABEL: Record<DecisionOutcome, string> = {
  approve: "Approved", reject: "Rejected", edit: "Edited and approved", request_changes: "Requested changes", delegate: "Delegated",
};

/** Requests that can still be acted on (before the clock is considered). */
export const isOpen = (status: DecisionStatus) => status === "pending" || status === "changes_requested";
export const isExpired = (expiresAt: string, now = Date.now()) => new Date(expiresAt).getTime() <= now;
/** The reviewer can decide only a pending, unexpired request; the server remains authoritative. */
export const canDecide = (status: DecisionStatus, expiresAt: string, now = Date.now()) => status === "pending" && !isExpired(expiresAt, now);

function span(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}
export function expiryLabel(expiresAt: string, now = Date.now()) {
  const delta = new Date(expiresAt).getTime() - now;
  return delta > 0 ? `Expires in ${span(delta)}` : `Expired ${span(-delta)} ago`;
}

export const shortDigest = (digest: string) => digest.slice(0, 12);

/** Plain-language outcome of an approved action: what was sent and what the agent then did. */
export function executionSummary(execution: Pick<DecisionExecutionView, "status" | "observedTaskState" | "error">) {
  const labels: Record<ExecutionStatus, string> = {
    pending: "Queued to send to the agent", dispatching: "Sending to the agent", succeeded: "Delivered to the agent",
    failed: "Could not be delivered", uncertain: "Delivery outcome unknown — not resent automatically",
  };
  const base = labels[execution.status];
  return execution.observedTaskState ? `${base}; task is now ${stateName(execution.observedTaskState)}` : base;
}

/**
 * Reuses one idempotency key per identical request so a retry or double click replays the same decision,
 * while a changed request (different outcome, text or rationale) gets a fresh key.
 */
export class IdempotencyKeys {
  private readonly keys = new Map<string, string>();
  constructor(private readonly generate: () => string = () => crypto.randomUUID()) {}
  keyFor(scope: string): string {
    let key = this.keys.get(scope);
    if (!key) { key = this.generate(); this.keys.set(scope, key); }
    return key;
  }
  clear() { this.keys.clear(); }
}
