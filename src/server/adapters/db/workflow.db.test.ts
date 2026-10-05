import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import type { DatabaseConfig } from "./config";
import { createDatabaseOrm } from "./orm";
import { createPersistenceRepositories } from "./repositories";
import { provisionIdentity } from "./identity-repository";
import { createGrant } from "./security-repository";
import { DatabaseAgentRegistry } from "./agent-registry";
import { MikroOrmWorkflowRepository } from "./workflow-repository";
import { AccessGrantEntity, SecurityAuditEntity, TaskAssignmentEntity, TaskAssignmentEventEntity, TaskNoteEntity, TaskEntity } from "./entities";
import { withPrincipal } from "../auth/principal-context";
import { bootstrapDefaultLocalOrganization } from "../../application/services/bootstrap-default-organization";
import { TaskWorkflowService } from "../../application/services/task-workflow";
import { readWorkflow, workflowSummaries, workflowTaskIds, workflowUnitOfWork } from "../../runtime/workflow";
import type { Principal } from "../../application/ports/identity";

const HOUR = 3_600_000;

async function contract(config: DatabaseConfig, directory: string) {
  let orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    expect(await orm.migrator.checkSchema()).toBe(false);
    const org = await bootstrapDefaultLocalOrganization(createPersistenceRepositories(orm.em.fork()).organizations);
    const foreign = await createPersistenceRepositories(orm.em.fork()).organizations.getOrCreate({ id: randomUUID(), slug: "foreign", name: "Foreign", createdAt: new Date(), updatedAt: new Date() });
    const registry = new DatabaseAgentRegistry({ orm, environmentUrls: () => [], legacyFilePath: join(directory, "absent") });
    const agent = await registry.add("https://fixture.example.test/card");
    const otherAgent = await registry.add("https://other.example.test/card");
    const task = async (state = "TASK_STATE_WORKING", agentId = agent.id) => {
      const id = randomUUID();
      await orm.em.getConnection().execute(
        "insert into tasks (id, organization_id, agent_id, tenant, remote_task_id, remote_context_id, kind, state, created_at, updated_at) values (?, ?, ?, '', ?, 'ctx', 'task', ?, now(), now())",
        [id, org.id, agentId, `remote-${id}`, state]);
      return id;
    };
    const person = (subject: string, role: "admin" | "operator" | "viewer", organizationId = org.id) =>
      provisionIdentity(orm.em.fork(), { issuer: "https://idp.example.test", subject, displayName: subject, organizationId, role });
    const admin = await person("admin", "admin"); const op1 = await person("op1", "operator"); const op2 = await person("op2", "operator");
    const unscoped = await person("unscoped", "operator"); const viewer = await person("viewer", "viewer"); const outsider = await person("outsider", "operator", foreign.id);
    for (const member of [op1, op2]) await orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: member.membershipId, agentId: agent.id, skillId: null, permission: "operate" }));

    let now = new Date();
    const service = new TaskWorkflowService(workflowUnitOfWork({ orm }), { now: () => now });
    const as = <T>(principal: Principal, work: () => Promise<T>) => withPrincipal(principal, work);
    const sql = (text: string, args: unknown[] = []) => orm.em.getConnection().execute(text, args);
    const fresh = async () => Number((await sql("select count(*)::int as c from outbox_messages where topic = 'task.freshness'"))[0].c);
    const events = (taskId: string) => orm.em.fork().find(TaskAssignmentEventEntity, { taskId }, { orderBy: { createdAt: "asc", id: "asc" } });
    const audits = (action: string, taskId: string) => orm.em.fork().count(SecurityAuditEntity, { action, targetId: taskId });
    const assignmentOf = (taskId: string) => orm.em.fork().findOne(TaskAssignmentEntity, { taskId });

    // --- Access: scoped, role-checked, hidden outside the grant and organization.
    const t1 = await task();
    await expect(as(viewer, () => service.claim(viewer, t1))).rejects.toMatchObject({ status: 403 });
    await expect(as(unscoped, () => service.claim(unscoped, t1))).rejects.toMatchObject({ status: 404 });
    await expect(as(outsider, () => service.claim(outsider, t1))).rejects.toMatchObject({ status: 404 });
    const finishedTask = await task("TASK_STATE_COMPLETED");
    await expect(as(op1, () => service.claim(op1, finishedTask))).rejects.toMatchObject({ status: 409 });
    expect(await readWorkflow(t1, { orm }).catch(() => "no-principal")).toBe("no-principal");
    expect(await as(outsider, () => readWorkflow(t1, { orm }))).toBeUndefined();
    expect(await as(unscoped, () => readWorkflow(t1, { orm }))).toBeUndefined();
    // Work for an agent the member has no grant on is invisible to them but manageable by an administrator.
    const restricted = await task("TASK_STATE_WORKING", otherAgent.id);
    await expect(as(op1, () => service.claim(op1, restricted))).rejects.toMatchObject({ status: 404 });
    expect(await as(op1, () => readWorkflow(restricted, { orm }))).toBeUndefined();
    await as(admin, () => service.claim(admin, restricted));
    await as(admin, () => service.release(admin, restricted));
    await expect(as(admin, () => service.assign(admin, restricted, op1.membershipId))).rejects.toMatchObject({ status: 422 });
    expect(await orm.em.fork().count(TaskAssignmentEntity, { taskId: t1 })).toBe(0);

    // --- Claiming: one winner, idempotent for the owner, announced and audited.
    const before = await fresh();
    const claims = await Promise.allSettled([as(op1, () => service.claim(op1, t1)), as(op2, () => service.claim(op2, t1))]);
    expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === "rejected").every((claim) => (claim as PromiseRejectedResult).reason.status === 409)).toBe(true);
    const owner = (await assignmentOf(t1))!.assigneeMembershipId === op1.membershipId ? op1 : op2;
    const other = owner === op1 ? op2 : op1;
    expect(await orm.em.fork().count(TaskAssignmentEntity, { taskId: t1 })).toBe(1);
    expect((await events(t1)).map((event) => event.kind)).toEqual(["claimed"]);
    expect(await fresh()).toBe(before + 1);
    await as(owner, () => service.claim(owner, t1));
    expect((await events(t1)).length).toBe(1);
    expect(await audits("task.claimed", t1)).toBe(1);
    expect(await orm.em.fork().count(TaskAssignmentEntity, { taskId: t1 })).toBe(1);

    // --- Release and reassignment follow ownership.
    await expect(as(other, () => service.release(other, t1))).rejects.toMatchObject({ status: 403 });
    await expect(as(other, () => service.assign(other, t1, other.membershipId))).rejects.toMatchObject({ status: 403 });
    await expect(as(admin, () => service.assign(admin, t1, unscoped.membershipId))).rejects.toMatchObject({ status: 422 });
    await expect(as(admin, () => service.assign(admin, t1, viewer.membershipId))).rejects.toMatchObject({ status: 422 });
    await as(admin, () => service.assign(admin, t1, other.membershipId));
    expect((await assignmentOf(t1))!.assigneeMembershipId).toBe(other.membershipId);
    await as(admin, () => service.assign(admin, t1, other.membershipId)); // Same assignee again is a no-op.
    expect((await events(t1)).map((event) => event.kind)).toEqual(["claimed", "assigned"]);
    const handover = (await events(t1))[1]!;
    expect([handover.fromMembershipId, handover.toMembershipId, handover.actorUserId]).toEqual([owner.membershipId, other.membershipId, admin.userId]);
    await as(other, () => service.assign(other, t1, owner.membershipId)); // The owner may hand over.
    await as(owner, () => service.release(owner, t1));
    expect((await assignmentOf(t1))!.assigneeMembershipId).toBeNull();
    await as(owner, () => service.release(owner, t1));
    expect((await events(t1)).map((event) => event.kind)).toEqual(["claimed", "assigned", "assigned", "released"]);
    await as(op2, () => service.assign(op2, t1, op1.membershipId)); // Anyone with access may route unowned work.
    await as(admin, () => service.release(admin, t1));

    // --- Due times: validated, owner-managed, idempotent.
    await as(op1, () => service.claim(op1, t1));
    const due = new Date(now.getTime() + 2 * HOUR);
    await expect(as(op1, () => service.setDue(op1, t1, new Date(now.getTime() - 1)))).rejects.toMatchObject({ status: 400 });
    await expect(as(op1, () => service.setDue(op1, t1, new Date(now.getTime() + 400 * 24 * HOUR)))).rejects.toMatchObject({ status: 400 });
    await expect(as(op2, () => service.setDue(op2, t1, due))).rejects.toMatchObject({ status: 403 });
    await as(op1, () => service.setDue(op1, t1, due));
    await as(op1, () => service.setDue(op1, t1, due));
    expect((await assignmentOf(t1))!.dueAt?.getTime()).toBe(due.getTime());
    expect((await events(t1)).filter((event) => event.kind === "due_set")).toHaveLength(1);
    await as(admin, () => service.setDue(admin, t1, null));
    expect((await events(t1)).at(-1)!.kind).toBe("due_cleared");
    await as(op1, () => service.release(op1, t1));

    // --- Notes: internal, append-only, idempotent per key.
    const key = randomUUID();
    await expect(as(viewer, () => service.addNote(viewer, t1, { body: "x", noteKey: key }))).rejects.toMatchObject({ status: 403 });
    await expect(as(op1, () => service.addNote(op1, t1, { body: "   ", noteKey: key }))).rejects.toMatchObject({ status: 400 });
    await expect(as(op1, () => service.addNote(op1, t1, { body: "x".repeat(4001), noteKey: key }))).rejects.toMatchObject({ status: 400 });
    const first = await as(op1, () => service.addNote(op1, t1, { body: "  Waiting on the vendor.  ", noteKey: key }));
    const [again, concurrent] = await Promise.all([as(op1, () => service.addNote(op1, t1, { body: "Waiting on the vendor.", noteKey: key })),
      as(op1, () => service.addNote(op1, t1, { body: "Waiting on the vendor.", noteKey: key }))]);
    expect([again.id, concurrent.id]).toEqual([first.id, first.id]);
    await expect(as(op2, () => service.addNote(op2, t1, { body: "Waiting on the vendor.", noteKey: key }))).rejects.toMatchObject({ status: 409 });
    await expect(as(op1, () => service.addNote(op1, t1, { body: "Different", noteKey: key }))).rejects.toMatchObject({ status: 409 });
    now = new Date(now.getTime() + 1000); // Notes sort by time; same-millisecond notes have no defined order.
    await as(op2, () => service.addNote(op2, t1, { body: "Escalate to finance.", noteKey: randomUUID() }));
    expect(await orm.em.fork().count(TaskNoteEntity, { taskId: t1 })).toBe(2);
    expect(await audits("task.note_added", t1)).toBe(2);
    const view = (await as(admin, () => readWorkflow(t1, { orm })))!;
    expect(view.notes.map((note) => note.body)).toEqual(["Escalate to finance.", "Waiting on the vendor."]);
    expect(view.people[op1.userId]).toBe("op1");
    expect(view.people[op2.userId]).toBe("op2");
    expect(view.viewer).toMatchObject({ role: "admin" });
    await expect(sql("update task_notes set body = 'forged' where id = ?", [first.id])).rejects.toThrow(/immutable/);
    await expect(sql("delete from task_notes where id = ?", [first.id])).rejects.toThrow(/immutable/);
    const anyEvent = (await events(t1))[0]!;
    await expect(sql("update task_assignment_events set kind = 'released' where id = ?", [anyEvent.id])).rejects.toThrow(/immutable/);
    await expect(sql("delete from task_assignment_events where id = ?", [anyEvent.id])).rejects.toThrow(/immutable/);

    // --- Escalation policy: administrator-only, eligible target, agent policy overrides organization policy.
    await expect(as(op1, () => service.setPolicy(op1, { agentId: null, targetMembershipId: op2.membershipId, enabled: true }))).rejects.toMatchObject({ status: 403 });
    await expect(as(admin, () => service.setPolicy(admin, { agentId: null, targetMembershipId: viewer.membershipId, enabled: true }))).rejects.toMatchObject({ status: 422 });
    await Promise.all([as(admin, () => service.setPolicy(admin, { agentId: null, targetMembershipId: op2.membershipId, enabled: true })),
      as(admin, () => service.setPolicy(admin, { agentId: null, targetMembershipId: op2.membershipId, enabled: true }))]);
    expect(await sql("select count(*)::int as c from escalation_policies where agent_id is null")).toEqual([{ c: 1 }]);

    // --- Escalation: due, unfinished, owned work moves to the target once per due time.
    const e1 = await task(); const e2 = await task(); const e3 = await task(); const e4 = await task();
    for (const id of [e1, e2, e3, e4]) await as(op1, () => service.claim(op1, id));
    for (const id of [e1, e2, e3, e4]) await as(op1, () => service.setDue(op1, id, new Date(now.getTime() + HOUR)));
    await orm.em.fork().nativeUpdate(TaskEntity, { id: e3 }, { state: "TASK_STATE_COMPLETED" });
    expect(await service.sweepEscalations()).toBe(0); // Nothing is due yet.
    now = new Date(now.getTime() + 2 * HOUR);
    const beforeEscalation = await fresh();
    const swept = await Promise.all([service.sweepEscalations(), service.sweepEscalations()]);
    expect(swept.reduce((sum, count) => sum + count, 0)).toBe(3); // e1, e2 and e4; the finished e3 is skipped.
    for (const id of [e1, e2, e4]) {
      expect(await assignmentOf(id)).toMatchObject({ assigneeMembershipId: op2.membershipId, escalationLevel: 1 });
      const escalation = (await events(id)).filter((event) => event.kind === "escalated");
      expect(escalation).toHaveLength(1);
      expect([escalation[0]!.actorUserId, escalation[0]!.fromMembershipId, escalation[0]!.toMembershipId]).toEqual([null, op1.membershipId, op2.membershipId]);
      expect(await audits("task.escalated", id)).toBe(1);
    }
    expect((await assignmentOf(e3))!.assigneeMembershipId).toBe(op1.membershipId);
    expect(await fresh()).toBeGreaterThan(beforeEscalation);
    const quiet = await fresh();
    expect(await service.sweepEscalations()).toBe(0);
    expect(await fresh()).toBe(quiet);
    // A new due time re-arms escalation; the level keeps counting.
    await as(op2, () => service.setDue(op2, e1, new Date(now.getTime() + HOUR)));
    now = new Date(now.getTime() + 2 * HOUR);
    await service.sweepEscalations();
    expect(await assignmentOf(e1)).toMatchObject({ escalationLevel: 2 });
    // A target who can no longer operate the agent leaves the owner in place and says so.
    await as(op1, () => service.claim(op1, e2).catch(() => undefined));
    await orm.em.fork().nativeUpdate(AccessGrantEntity, { subjectId: op2.membershipId }, { enabled: false });
    const e5 = await task(); await as(op1, () => service.claim(op1, e5)); await as(op1, () => service.setDue(op1, e5, new Date(now.getTime() + HOUR)));
    now = new Date(now.getTime() + 2 * HOUR);
    await service.sweepEscalations();
    expect(await assignmentOf(e5)).toMatchObject({ assigneeMembershipId: op1.membershipId, escalationLevel: 1 });
    expect((await events(e5)).find((event) => event.kind === "escalated")).toMatchObject({ toMembershipId: null, fromMembershipId: op1.membershipId });
    await orm.em.fork().nativeUpdate(AccessGrantEntity, { subjectId: op2.membershipId }, { enabled: true });
    // An agent-specific policy overrides the organization-wide one, and a disabled policy does nothing.
    const e6 = await task(); const e7 = await task();
    await as(admin, () => service.setPolicy(admin, { agentId: agent.id, targetMembershipId: op1.membershipId, enabled: true }));
    await as(op2, () => service.claim(op2, e6)); await as(op2, () => service.setDue(op2, e6, new Date(now.getTime() + HOUR)));
    await as(op2, () => service.claim(op2, e7)); await as(op2, () => service.setDue(op2, e7, new Date(now.getTime() + HOUR)));
    await as(admin, () => service.setPolicy(admin, { agentId: agent.id, targetMembershipId: op1.membershipId, enabled: true }));
    now = new Date(now.getTime() + 2 * HOUR);
    await service.sweepEscalations();
    expect((await assignmentOf(e6))!.assigneeMembershipId).toBe(op1.membershipId);
    await as(admin, () => service.setPolicy(admin, { agentId: agent.id, targetMembershipId: op1.membershipId, enabled: false }));
    await as(admin, () => service.setPolicy(admin, { agentId: null, targetMembershipId: op2.membershipId, enabled: false }));
    const e8 = await task(); await as(op1, () => service.claim(op1, e8)); await as(op1, () => service.setDue(op1, e8, new Date(now.getTime() + HOUR)));
    now = new Date(now.getTime() + 2 * HOUR);
    expect(await service.sweepEscalations()).toBe(0);
    expect((await assignmentOf(e8))!.assigneeMembershipId).toBe(op1.membershipId);

    // --- Queue views: mine, overdue and unassigned, scoped to the signed-in member.
    const q1 = await task(); const q2 = await task(); const q3 = await task();
    await as(op1, () => service.claim(op1, q1)); await as(op1, () => service.claim(op1, q2)); await as(op1, () => service.release(op1, q2));
    await orm.em.fork().nativeUpdate(TaskAssignmentEntity, { taskId: q1 }, { dueAt: new Date(Date.now() - HOUR) });
    const repo = () => new MikroOrmWorkflowRepository(orm.em.fork());
    expect(await repo().taskIdsFor(org.id, "mine", op1.membershipId, new Date())).toContain(q1);
    expect(await repo().taskIdsFor(org.id, "mine", op2.membershipId, new Date())).not.toContain(q1);
    expect(await repo().taskIdsFor(org.id, "overdue", op1.membershipId, new Date())).toContain(q1);
    expect(await repo().taskIdsFor(org.id, "overdue", op1.membershipId, new Date())).not.toContain(e3); // Finished work is never overdue.
    const assigned = await repo().taskIdsFor(org.id, "unassigned", op1.membershipId, new Date());
    expect(assigned).toContain(q1); expect(assigned).not.toContain(q2); expect(assigned).not.toContain(q3);
    expect(await as(op1, () => workflowTaskIds("mine", { orm }))).toContain(q1);
    const summaries = await as(op2, () => workflowSummaries([q1, q3], { orm }));
    expect(summaries.get(q1)).toMatchObject({ assigneeName: "op1", escalationLevel: 0 });
    expect(summaries.has(q3)).toBe(false);
    expect(await as(outsider, () => workflowSummaries([q1], { orm }))).toEqual(new Map());

    // --- Everything survives a restart; rollback and reapply restore the same schema.
    await orm.close(true); orm = await createDatabaseOrm(config);
    expect((await as(admin, () => readWorkflow(t1, { orm })))!.notes).toHaveLength(2);
    expect(await orm.em.fork().count(TaskAssignmentEventEntity, { taskId: e1 })).toBeGreaterThanOrEqual(3);
    await orm.migrator.down();
    await orm.migrator.up();
    expect(await orm.migrator.checkSchema()).toBe(false);
  } finally { await orm.close(true); }
}

async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-workflow-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("HITL-005 PGlite task workflow", () => {
  it("verifies claiming, assignment, due times, escalation, notes and immutable history", async () => {
    await temporary((directory) => contract({ profile: "pglite", dataDir: join(directory, "db") }, directory));
  });
});
const postgresUrl = process.env.A2A_TEST_POSTGRES_URL;
if (process.env.CI === "true" && !postgresUrl) throw new Error("CI must set A2A_TEST_POSTGRES_URL");
if (postgresUrl && !decodeURIComponent(new URL(postgresUrl).pathname).includes("test")) throw new Error("A2A_TEST_POSTGRES_URL must target a test database");
(postgresUrl ? describe : describe.skip)("TST-001 PostgreSQL task workflow", () => {
  it("passes the same workflow contract", async () => {
    await temporary((directory) => contract({ profile: "postgresql", url: postgresUrl! }, directory));
  });
});
