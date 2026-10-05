import type { AssignmentEventView, AssignmentView } from "@/shared/workflow-types";

function span(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}
export const isOverdue = (dueAt: string | null | undefined, now = Date.now()) => Boolean(dueAt) && new Date(dueAt!).getTime() <= now;
export function dueLabel(dueAt: string, now = Date.now()) {
  const delta = new Date(dueAt).getTime() - now;
  return delta > 0 ? `Due in ${span(delta)}` : `Overdue by ${span(-delta)}`;
}

/** Mirrors the server rule: the owner and administrators manage owned work; anyone with access may take unowned work. */
export function canManage(viewer: { membershipId: string; role: string }, assignment: Pick<AssignmentView, "assigneeMembershipId"> | null) {
  return viewer.role === "admin" || !assignment?.assigneeMembershipId || assignment.assigneeMembershipId === viewer.membershipId;
}
export const canOperate = (role: string) => role === "admin" || role === "operator";

export function assigneeLabel(assignment: Pick<AssignmentView, "assigneeMembershipId"> | null, viewerMembershipId: string, people: Record<string, string>) {
  if (!assignment?.assigneeMembershipId) return "Unassigned";
  return assignment.assigneeMembershipId === viewerMembershipId ? "You" : people[assignment.assigneeMembershipId] ?? "Another reviewer";
}

/** One line of plain-language activity, naming the people involved. */
export function eventSummary(event: AssignmentEventView, people: Record<string, string>, viewerMembershipId: string) {
  const name = (id: string | null) => id === viewerMembershipId ? "you" : id ? people[id] ?? "another reviewer" : "nobody";
  const actor = event.actorUserId ? people[event.actorUserId] ?? "Someone" : "The system";
  switch (event.kind) {
    case "claimed": return `${actor} claimed this task`;
    case "released": return `${actor} released it${event.fromMembershipId ? ` (was ${name(event.fromMembershipId)})` : ""}`;
    case "assigned": return `${actor} assigned it to ${name(event.toMembershipId)}`;
    case "due_set": return `${actor} set the due time${event.dueAt ? ` to ${new Date(event.dueAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : ""}`;
    case "due_cleared": return `${actor} cleared the due time`;
    case "escalated": return event.toMembershipId ? `Escalated from ${name(event.fromMembershipId)} to ${name(event.toMembershipId)} after it became overdue`
      : `Overdue and escalated, but the escalation target could not take it; ${name(event.fromMembershipId)} keeps it`;
  }
}

/** datetime-local inputs use local wall time without a zone; convert both ways without shifting the instant. */
export const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
export const fromLocalInput = (value: string) => value ? new Date(value).toISOString() : null;
