import type { AuditEntryView, AuditGroup } from "@/shared/audit-types";
import { shortDigest } from "./approvals";

export const GROUP_LABEL: Record<AuditGroup, string> = { all: "All", approvals: "Approvals", ownership: "Ownership & notes", commands: "Messages sent", access: "Access & identity" };

const text = (value: unknown) => typeof value === "string" && value ? value : undefined;
const num = (value: unknown) => typeof value === "number" ? value : undefined;

export interface AuditDescription {
  /** One plain-language sentence naming who did what. */
  summary: string;
  /** Exact facts behind it, shown on demand: the content decided, the rationale, the revision and its digest. */
  facts: Array<[label: string, value: string]>;
}

const HUMANIZED: Record<string, string> = {
  "access.granted": "granted access", "access.revoked": "revoked access", "team.created": "created a team", "team.member_added": "added a team member",
  "team.member_removed": "removed a team member", "agent.registered": "registered an agent", "agent.removed": "removed an agent",
  "session.started": "signed in", "session.ended": "signed out", "credential.rotated": "rotated an agent credential",
  "credential.revoked": "revoked an agent credential", "identity.provisioned": "provisioned a member", "escalation.policy_saved": "saved an escalation rule",
  "task.send.accepted": "sent a message to an agent", "task.cancel.accepted": "asked an agent to cancel a task",
};
export function humanizeAction(action: string) {
  return HUMANIZED[action] ?? action.replace(/[._]+/g, " ").replace(/^./, (character) => character.toUpperCase());
}

/**
 * Words an entry for people. `names` maps user and membership IDs; the viewer is called "you". Only the fields the server
 * returned are used, so an entry the viewer may see never reveals more than its data holds.
 */
export function describeEntry(entry: AuditEntryView, people: Record<string, string>, viewerUserId: string, viewerMembershipId: string): AuditDescription {
  const actor = entry.actorUserId ? (entry.actorUserId === viewerUserId ? "You" : people[entry.actorUserId] ?? "A former member") : entry.data.actorType === "agent" ? "The agent" : "The system";
  const member = (id: unknown) => typeof id === "string" ? (id === viewerMembershipId ? "you" : people[id] ?? "another reviewer") : "nobody";
  const title = text(entry.data.title);
  const quoted = title ? `“${title}”` : "an approval request";
  const facts: Array<[string, string]> = [];
  const revision = num(entry.data.revision);
  const digest = text(entry.data.digest);
  const body = text(entry.data.text);
  if (revision !== undefined) facts.push(["Revision", `${revision}${digest ? ` · ${shortDigest(digest)}` : ""}`]);
  else if (digest) facts.push(["Digest", shortDigest(digest)]);
  if (body) facts.push([entry.kind === "decision.requested" ? "Proposed action" : "Exact content", body]);
  const rationale = text(entry.data.rationale);
  if (rationale) facts.push(["Rationale", rationale]);

  switch (entry.kind) {
    case "decision.requested": {
      const risk = text(entry.data.risk); if (risk) facts.push(["Risk", risk]);
      const expires = text(entry.data.expiresAt); if (expires) facts.push(["Expires", new Date(expires).toLocaleString()]);
      return { summary: `${actor} requested approval: ${quoted}`, facts };
    }
    case "decision.revised": return { summary: `${actor} proposed a new version of ${quoted}`, facts };
    case "decision.approve":
    case "decision.edit": {
      const delivery = text(entry.data.delivery);
      if (delivery) facts.push(["Delivery", `${delivery}${text(entry.data.observedTaskState) ? ` · task ${text(entry.data.observedTaskState)!.replace("TASK_STATE_", "")}` : ""}`]);
      const message = text(entry.data.messageId); if (message) facts.push(["Message ID", message]);
      return { summary: `${actor} ${entry.kind === "decision.edit" ? "edited and approved" : "approved"} ${quoted}`, facts };
    }
    case "decision.reject": return { summary: `${actor} rejected ${quoted}`, facts };
    case "decision.request_changes": return { summary: `${actor} asked for changes to ${quoted}`, facts };
    case "decision.delegate": return { summary: `${actor} handed ${quoted} to ${member(entry.data.delegateMembershipId)}`, facts };
    case "decision.expired": return { summary: `${quoted} expired without a decision`, facts };
    case "decision.superseded": return { summary: `${quoted} was superseded and can no longer authorize anything`, facts };
    case "task.claimed": return { summary: `${actor} claimed the task`, facts: [] };
    case "task.released": return { summary: `${actor} released the task${entry.data.fromMembershipId ? ` (was ${member(entry.data.fromMembershipId)})` : ""}`, facts: [] };
    case "task.assigned": return { summary: `${actor} assigned the task to ${member(entry.data.toMembershipId)}${entry.data.fromMembershipId ? ` (was ${member(entry.data.fromMembershipId)})` : ""}`, facts: [] };
    case "task.due_set": return { summary: `${actor} set the due time${text(entry.data.dueAt) ? ` to ${new Date(text(entry.data.dueAt)!).toLocaleString()}` : ""}`, facts: [] };
    case "task.due_cleared": return { summary: `${actor} cleared the due time`, facts: [] };
    case "task.escalated": return { summary: entry.data.toMembershipId ? `Overdue task escalated from ${member(entry.data.fromMembershipId)} to ${member(entry.data.toMembershipId)}`
      : `Overdue task escalated, but the target could not take it; ${member(entry.data.fromMembershipId)} kept it`, facts: [] };
    case "task.note_added": return { summary: `${actor} added an internal note`, facts: [] };
    default: return { summary: `${actor} ${HUMANIZED[entry.kind] ?? humanizeAction(entry.kind).toLowerCase()}`, facts: [] };
  }
}

/** Filters that reach the API; empty values are omitted so the URL stays minimal. */
export function auditParams(filters: { taskId?: string; group?: AuditGroup; since?: string; until?: string; cursor?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (filters.taskId) params.set("taskId", filters.taskId);
  if (filters.group && filters.group !== "all") params.set("group", filters.group);
  if (filters.since) params.set("since", new Date(filters.since).toISOString());
  if (filters.until) params.set("until", new Date(filters.until).toISOString());
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.limit) params.set("limit", String(filters.limit));
  return params;
}
