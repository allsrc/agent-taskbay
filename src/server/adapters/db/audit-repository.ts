import type { EntityManager } from "@mikro-orm/core";
import type { AuditGroup, AuditQuery, AuditRepository, AuditRow } from "../../application/ports/audit";

const OWNERSHIP_ACTIONS = ["task.claimed", "task.released", "task.assigned", "task.due_set", "task.due_cleared", "task.escalated", "task.note_added"];
const COMMAND_ACTIONS = ["task.send.accepted", "task.cancel.accepted"];
const quoted = (values: string[]) => values.map((value) => `'${value}'`).join(", ");

/**
 * The unified, read-only timeline. Decisions, revisions, ownership history and notes come from their own immutable
 * rows (so the entry carries exactly what was decided and when); every other audit fact comes from the audit table.
 * Audit facts that those rows already represent are not repeated.
 */
const TIMELINE = `
  select r.created_at as at, 'req:' || r.id as key, 'decision.requested' as kind, r.requester_user_id as actor_user_id, r.task_id as task_id, r.id::text as subject_id,
    jsonb_build_object('title', r.title, 'actorType', case when r.requester_user_id is null then 'agent' else 'user' end, 'summary', r.summary, 'risk', r.risk, 'expiresAt', r.expires_at, 'assignedMembershipId', r.assigned_membership_id,
      'text', (select v.action_json->>'text' from decision_revisions v where v.request_id = r.id and v.number = 1), 'digest', (select v.digest from decision_revisions v where v.request_id = r.id and v.number = 1)) as data
  from decision_requests r where r.organization_id = :org
  union all
  select v.created_at, 'rev:' || v.id, 'decision.revised', v.author_user_id, r.task_id, r.id::text,
    jsonb_build_object('title', r.title, 'revision', v.number, 'digest', v.digest, 'text', v.action_json->>'text')
  from decision_revisions v join decision_requests r on r.id = v.request_id where v.organization_id = :org and v.number > 1
  union all
  select d.created_at, 'dec:' || d.id, 'decision.' || d.outcome, d.reviewer_user_id, r.task_id, r.id::text,
    jsonb_build_object('title', r.title, 'decisionId', d.id, 'rationale', d.rationale, 'revision', v.number, 'digest', d.revision_digest, 'text', v.action_json->>'text',
      'reviewerMembershipId', d.reviewer_membership_id, 'delegateMembershipId', d.delegate_membership_id,
      'delivery', (select x.status from decision_executions x where x.decision_id = d.id), 'observedTaskState', (select x.observed_task_state from decision_executions x where x.decision_id = d.id),
      'messageId', (select x.message_id from decision_executions x where x.decision_id = d.id))
  from decisions d join decision_requests r on r.id = d.request_id join decision_revisions v on v.id = d.revision_id where d.organization_id = :org
  union all
  select a.created_at, 'aud:' || a.id, a.action, a.actor_user_id, r.task_id, r.id::text, jsonb_build_object('title', r.title, 'actorType', a.actor_type)
  from security_audit_events a join decision_requests r on r.id::text = a.target_id
  where a.organization_id = :org and a.action in ('decision.expired', 'decision.superseded')
  union all
  select e.created_at, 'own:' || e.id, 'task.' || e.kind, e.actor_user_id, e.task_id, e.task_id::text,
    jsonb_build_object('fromMembershipId', e.from_membership_id, 'toMembershipId', e.to_membership_id, 'dueAt', e.due_at)
  from task_assignment_events e where e.organization_id = :org
  union all
  select n.created_at, 'note:' || n.id, 'task.note_added', n.author_user_id, n.task_id, n.task_id::text, '{}'::jsonb
  from task_notes n where n.organization_id = :org
  union all
  select a.created_at, 'aud:' || a.id, a.action, a.actor_user_id, null::uuid, a.target_id, jsonb_build_object('actorType', a.actor_type)
  from security_audit_events a where a.organization_id = :org and a.action not like 'decision.%' and a.action not in (${quoted(OWNERSHIP_ACTIONS)})`;

const GROUP_PREDICATE: Record<AuditGroup, string | null> = {
  all: null,
  approvals: "kind like 'decision.%'",
  ownership: `kind in (${quoted(OWNERSHIP_ACTIONS)})`,
  commands: `kind in (${quoted(COMMAND_ACTIONS)})`,
  access: `kind not like 'decision.%' and kind not in (${quoted([...OWNERSHIP_ACTIONS, ...COMMAND_ACTIONS])})`,
};

export const encodeCursor = (row: Pick<AuditRow, "at" | "key">) => Buffer.from(JSON.stringify([row.at.toISOString(), row.key])).toString("base64url");
export function decodeCursor(cursor: string): [Date, string] | undefined {
  try {
    const [at, key] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [string, string];
    const date = new Date(at);
    return typeof key === "string" && key.length < 200 && !Number.isNaN(date.getTime()) ? [date, key] : undefined;
  } catch { return undefined; }
}

export class MikroOrmAuditRepository implements AuditRepository {
  constructor(private readonly em: EntityManager) {}

  async page(organizationId: string, query: AuditQuery) {
    const where: string[] = [];
    const params: Record<string, unknown> = { org: organizationId };
    if (query.taskId) { where.push("task_id = :task"); params.task = query.taskId; }
    const group = GROUP_PREDICATE[query.group ?? "all"];
    if (group) where.push(group);
    if (query.actorUserId) { where.push("actor_user_id = :actor"); params.actor = query.actorUserId; }
    if (query.since) { where.push("at >= :since"); params.since = query.since; }
    if (query.until) { where.push("at <= :until"); params.until = query.until; }
    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      if (!decoded) throw Object.assign(new Error("Invalid cursor."), { status: 400 });
      where.push("(at < :cursorAt or (at = :cursorAt and key < :cursorKey))"); params.cursorAt = decoded[0]; params.cursorKey = decoded[1];
    }
    // Named parameters are bound by position for the driver, in order of appearance.
    const sql = `select * from (${TIMELINE}) timeline ${where.length ? `where ${where.join(" and ")}` : ""} order by at desc, key desc limit :limit`;
    params.limit = query.limit + 1;
    const ordered: unknown[] = [];
    const text = sql.replace(/(?<!:):(\w+)/g, (_match, name: string) => { ordered.push(params[name]); return "?"; });
    const rows = await this.em.getConnection().execute(text, ordered, "all", this.em.getTransactionContext()) as Array<{
      at: Date; key: string; kind: string; actor_user_id: string | null; task_id: string | null; subject_id: string | null; data: Record<string, unknown> }>;
    return rows.map((row): AuditRow => ({ key: row.key, at: new Date(row.at), kind: row.kind, actorUserId: row.actor_user_id, taskId: row.task_id,
      subjectId: row.subject_id, data: row.data ?? {} }));
  }
}
