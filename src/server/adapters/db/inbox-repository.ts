import type { EntityManager } from "@mikro-orm/core";
import type { InboxQuery, InboxRepository, InboxRow } from "../../application/ports/inbox";

const TERMINAL = "('TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED')";
const NEEDS_INPUT = "('TASK_STATE_INPUT_REQUIRED', 'TASK_STATE_AUTH_REQUIRED')";
const OPEN_APPROVAL = "('pending', 'changes_requested')";

interface Fragment { sql: string; args: unknown[] }
const none: Fragment = { sql: "", args: [] };
const and = (...parts: Fragment[]): Fragment => ({ sql: parts.map((p) => p.sql).filter(Boolean).map((s) => ` and ${s}`).join(""), args: parts.flatMap((p) => p.args) });

/** Grants become typed agent/skill predicates before paging, exactly as task and approval lists scope them. */
function scopeFragment(scope: InboxQuery["scope"], agent: string, skill: string): Fragment {
  if (!scope) return none;
  if (!scope.length) return { sql: "false", args: [] };
  return { sql: `(${scope.map((grant) => grant.skillId === null ? `${agent} = ?` : `(${agent} = ? and ${skill} = ?)`).join(" or ")})`,
    args: scope.flatMap((grant) => grant.skillId === null ? [grant.agentId] : [grant.agentId, grant.skillId]) };
}

/** `undefined` means the view excludes this kind entirely. */
function taskBranch(query: InboxQuery): Fragment | undefined {
  if (query.kind === "approval" || query.risk) return undefined;
  const parts: Fragment[] = [{ sql: "t.organization_id = ?", args: [query.organizationId] }, { sql: "t.kind = 'task'", args: [] }, scopeFragment(query.scope, "t.agent_id", "t.skill_id")];
  const live = { sql: `t.terminal_at is null and t.state not in ${TERMINAL}`, args: [] };
  switch (query.view) {
    case "active": parts.push(live); break;
    case "needs-input": parts.push({ sql: `t.state in ${NEEDS_INPUT}`, args: [] }); break;
    case "assigned": parts.push(live, { sql: "a.assignee_membership_id = ?", args: [query.membershipId] }); break;
    case "overdue": parts.push(live, { sql: "a.due_at <= ?", args: [query.now] }); break;
    case "done": parts.push({ sql: `(t.terminal_at is not null or t.state in ${TERMINAL})`, args: [] }); break;
    case "all": break;
  }
  if (query.agentId) parts.push({ sql: "t.agent_id = ?", args: [query.agentId] });
  if (query.skillId) parts.push({ sql: "t.skill_id = ?", args: [query.skillId] });
  if (query.status) parts.push({ sql: "t.state = ?", args: [query.status] });
  if (query.updatedAfter) parts.push({ sql: "t.updated_at > ?", args: [query.updatedAfter] });
  return and(...parts);
}

function approvalBranch(query: InboxQuery): Fragment | undefined {
  if (query.kind === "task") return undefined;
  const parts: Fragment[] = [{ sql: "r.organization_id = ?", args: [query.organizationId] }, scopeFragment(query.scope, "r.agent_id", "r.skill_id")];
  switch (query.view) {
    case "active": parts.push({ sql: `r.status in ${OPEN_APPROVAL}`, args: [] }); break;
    // A pending approval is always something a reviewer must act on.
    case "needs-input": parts.push({ sql: `r.status in ${OPEN_APPROVAL}`, args: [] }); break;
    case "assigned": parts.push({ sql: `r.status in ${OPEN_APPROVAL}`, args: [] }, { sql: "r.assigned_membership_id = ?", args: [query.membershipId] }); break;
    case "overdue": parts.push({ sql: `r.status in ${OPEN_APPROVAL}`, args: [] }, { sql: "r.expires_at <= ?", args: [query.now] }); break;
    case "done": parts.push({ sql: `r.status not in ${OPEN_APPROVAL}`, args: [] }); break;
    case "all": break;
  }
  if (query.agentId) parts.push({ sql: "r.agent_id = ?", args: [query.agentId] });
  if (query.skillId) parts.push({ sql: "r.skill_id = ?", args: [query.skillId] });
  if (query.risk) parts.push({ sql: "r.risk = ?", args: [query.risk] });
  if (query.status) parts.push({ sql: "r.status = ?", args: [query.status] });
  if (query.updatedAfter) parts.push({ sql: "r.updated_at > ?", args: [query.updatedAfter] });
  return and(...parts);
}

export class MikroOrmInboxRepository implements InboxRepository {
  constructor(private readonly em: EntityManager) {}

  async page(query: InboxQuery): Promise<InboxRow[]> {
    const branches: Fragment[] = [];
    const tasks = taskBranch(query);
    if (tasks) branches.push({ sql: `select 'task' as kind, t.id, t.id as task_id, t.agent_id, t.skill_id, t.state as status, t.title, null::text as risk,
        a.assignee_membership_id, a.due_at, null::timestamptz as expires_at, coalesce(a.escalation_level, 0) as escalation_level, t.updated_at
      from tasks t left join task_assignments a on a.task_id = t.id where true${tasks.sql}`, args: tasks.args });
    const approvals = approvalBranch(query);
    if (approvals) branches.push({ sql: `select 'approval' as kind, r.id, r.task_id, r.agent_id, r.skill_id, r.status, r.title, r.risk,
        r.assigned_membership_id as assignee_membership_id, null::timestamptz as due_at, r.expires_at, 0 as escalation_level, r.updated_at
      from decision_requests r where true${approvals.sql}`, args: approvals.args });
    if (!branches.length) return [];
    const after = query.after ? { sql: "where (u.updated_at, u.id) < (?, ?::uuid)", args: [query.after.updatedAt, query.after.id] } : { sql: "", args: [] };
    const rows = await this.em.getConnection().execute(
      `select * from (${branches.map((branch) => branch.sql).join(" union all ")}) u ${after.sql} order by u.updated_at desc, u.id desc limit ?`,
      [...branches.flatMap((branch) => branch.args), ...after.args, query.limit], "all", this.em.getTransactionContext()) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      kind: row.kind as InboxRow["kind"], id: String(row.id), taskId: String(row.task_id), agentId: String(row.agent_id),
      skillId: (row.skill_id as string | null) ?? null, status: String(row.status), title: (row.title as string | null) ?? null,
      risk: (row.risk as InboxRow["risk"]) ?? null, assigneeMembershipId: (row.assignee_membership_id as string | null) ?? null,
      dueAt: row.due_at ? new Date(row.due_at as string | Date) : null, expiresAt: row.expires_at ? new Date(row.expires_at as string | Date) : null,
      escalationLevel: Number(row.escalation_level), updatedAt: new Date(row.updated_at as string | Date),
    }));
  }
}
