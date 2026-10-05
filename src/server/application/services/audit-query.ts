import type { Principal } from "../ports/identity";
import type { AuditPorts, AuditQuery, AuditRow, AuditUnitOfWork } from "../ports/audit";
import { AuthorizationError } from "./authorization";

export const MAX_AUDIT_PAGE = 200;
export class AuditError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

const MEMBERSHIP_FIELDS = ["fromMembershipId", "toMembershipId", "delegateMembershipId", "reviewerMembershipId", "assignedMembershipId"];

/**
 * Read-only access to the organization's workflow history. The organization-wide trail is for administrators; any
 * member who can read a task's agent may read that one task's trail, which excludes identity and access facts.
 */
export class AuditQueryService {
  constructor(private readonly work: AuditUnitOfWork, private readonly encode: (row: AuditRow) => string) {}

  async page(principal: Principal, query: AuditQuery) {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > MAX_AUDIT_PAGE) throw new AuditError(`limit must be 1–${MAX_AUDIT_PAGE}.`, 400);
    if (query.since && query.until && query.since > query.until) throw new AuditError("The start of the range is after its end.", 400);
    return this.work.run(async (ports) => {
      await this.authorizeScope(ports, principal, query.taskId);
      const rows = await ports.audit.page(principal.organizationId, query);
      const visible = rows.slice(0, query.limit);
      const memberships = [...new Set(visible.flatMap((row) => MEMBERSHIP_FIELDS.map((field) => row.data[field]).filter((id): id is string => typeof id === "string")))];
      const users = [...new Set(visible.flatMap((row) => row.actorUserId ? [row.actorUserId] : []))];
      const tasks = [...new Set(visible.flatMap((row) => row.taskId ? [row.taskId] : []))];
      const [people, context] = await Promise.all([ports.names(principal.organizationId, users, memberships), ports.taskContext(principal.organizationId, tasks)]);
      return { entries: visible, people, context, next: rows.length > query.limit ? this.encode(visible.at(-1)!) : null };
    });
  }

  private async authorizeScope(ports: AuditPorts, principal: Principal, taskId?: string) {
    if (!taskId) {
      if (principal.role !== "admin") throw new AuthorizationError();
      return;
    }
    // Same visibility as the task itself: no read grant means it does not exist for this member.
    const task = await ports.tasks.findById(principal.organizationId, taskId);
    if (!task || !await ports.canRead(principal, task.agentId, task.skillId ?? null)) throw new AuditError("Task not found.", 404);
  }
}
