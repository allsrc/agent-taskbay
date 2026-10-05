import type { InboxItem, InboxKind, InboxPageView, InboxView } from "../../../shared/inbox-types";
import type { InboxQuery, InboxRepository, InboxRow } from "../ports/inbox";
import type { Clock } from "../ports/clock";

export class InboxError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export const INBOX_VIEWS: readonly InboxView[] = ["all", "active", "needs-input", "assigned", "overdue", "done"];
const KINDS: readonly InboxKind[] = ["task", "approval"];
const RISKS = ["low", "medium", "high"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_INBOX_PAGE = 100;

export interface InboxRequest {
  view?: string; kind?: string; agentId?: string; skillId?: string; risk?: string; status?: string; updatedAfter?: string; cursor?: string; limit?: number;
}
export interface InboxCaller { organizationId: string; membershipId: string; scope?: InboxQuery["scope"] }
/** Display-only lookups for rows the caller can already see. */
export interface InboxNames { agents(organizationId: string, ids: string[]): Promise<Record<string, string>>; people(organizationId: string, membershipIds: string[]): Promise<Record<string, string>> }

export const encodeCursor = (row: Pick<InboxRow, "updatedAt" | "id">) => Buffer.from(`${row.updatedAt.toISOString()}|${row.id}`).toString("base64url");
export function decodeCursor(cursor: string): { updatedAt: Date; id: string } {
  const [time, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const updatedAt = new Date(time ?? "");
  if (!id || !UUID.test(id) || Number.isNaN(updatedAt.getTime())) throw new InboxError("Invalid cursor.");
  return { updatedAt, id };
}

export function parseInboxRequest(request: InboxRequest): Omit<InboxQuery, "organizationId" | "membershipId" | "now" | "scope"> {
  const view = request.view ?? "all";
  if (!(INBOX_VIEWS as readonly string[]).includes(view)) throw new InboxError("Unknown inbox view.");
  if (request.kind && !(KINDS as readonly string[]).includes(request.kind)) throw new InboxError("Unknown item kind.");
  if (request.risk && !(RISKS as readonly string[]).includes(request.risk)) throw new InboxError("Unknown risk.");
  for (const id of [request.agentId]) if (id && !UUID.test(id)) throw new InboxError("agentId must be a UUID.");
  if (request.skillId && request.skillId.length > 255) throw new InboxError("skillId is too long.");
  if (request.status && request.status.length > 64) throw new InboxError("status is too long.");
  const limit = request.limit ?? 30;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_INBOX_PAGE) throw new InboxError(`limit must be 1–${MAX_INBOX_PAGE}.`);
  const updatedAfter = request.updatedAfter ? new Date(request.updatedAfter) : undefined;
  if (updatedAfter && Number.isNaN(updatedAfter.getTime())) throw new InboxError("updatedAfter must be a timestamp.");
  return { view: view as InboxView, kind: request.kind as InboxKind | undefined, agentId: request.agentId, skillId: request.skillId,
    risk: request.risk as InboxQuery["risk"], status: request.status, updatedAfter, after: request.cursor ? decodeCursor(request.cursor) : undefined, limit };
}

const OPEN_APPROVAL = new Set(["pending", "changes_requested"]);
const TERMINAL_TASK = new Set(["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"]);

/** One authorized, indexed read over tasks and approvals; no event payload or content projection is touched. */
export class InboxQueryService {
  constructor(private readonly inbox: InboxRepository, private readonly names: InboxNames, private readonly clock: Clock) {}

  async page(caller: InboxCaller, request: InboxRequest): Promise<InboxPageView> {
    const parsed = parseInboxRequest(request);
    const rows = await this.inbox.page({ ...parsed, organizationId: caller.organizationId, membershipId: caller.membershipId, now: this.clock.now(),
      scope: caller.scope, limit: parsed.limit + 1 });
    const shown = rows.slice(0, parsed.limit);
    const [agents, people] = await Promise.all([
      this.names.agents(caller.organizationId, [...new Set(shown.map((row) => row.agentId))]),
      this.names.people(caller.organizationId, [...new Set(shown.flatMap((row) => row.assigneeMembershipId ? [row.assigneeMembershipId] : []))]),
    ]);
    const items = shown.map((row): InboxItem => ({
      kind: row.kind, id: row.id, taskId: row.taskId, agentId: row.agentId, agentName: agents[row.agentId] ?? "Agent", skillId: row.skillId, status: row.status,
      open: row.kind === "approval" ? OPEN_APPROVAL.has(row.status) : !TERMINAL_TASK.has(row.status),
      title: row.title?.trim() || (row.kind === "approval" ? "Approval request" : "Untitled task"), risk: row.risk,
      assigneeMembershipId: row.assigneeMembershipId, assigneeName: row.assigneeMembershipId ? people[row.assigneeMembershipId] ?? null : null,
      dueAt: row.dueAt?.toISOString() ?? null, expiresAt: row.expiresAt?.toISOString() ?? null, escalationLevel: row.escalationLevel, updatedAt: row.updatedAt.toISOString(),
    }));
    return { items, next: rows.length > parsed.limit ? encodeCursor(shown.at(-1)!) : null };
  }
}
