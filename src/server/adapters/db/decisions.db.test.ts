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
import { SecurityAuditEntity, TaskEntity, TaskCommandEntity, DecisionExecutionEntity, DecisionEntity, DecisionRevisionEntity } from "./entities";
import { withPrincipal } from "../auth/principal-context";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { bootstrapDefaultLocalOrganization } from "../../application/services/bootstrap-default-organization";
import { DecisionService } from "../../application/services/decisions";
import { decisionPorts, decisionUnitOfWork, listDecisions, readDecision } from "../../runtime/decisions";
import type { Principal } from "../../application/ports/identity";
import type { ProposedAction } from "../../domain/decision-model";

const HOUR = 3_600_000;
const action = (text: string): ProposedAction => ({ kind: "send_message", text });

async function contract(config: DatabaseConfig, directory: string) {
  let orm = await createDatabaseOrm(config);
  const store = new FilesystemArtifactStore(join(directory, "artifacts"));
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    expect(await orm.migrator.checkSchema()).toBe(false);
    const org = await bootstrapDefaultLocalOrganization(createPersistenceRepositories(orm.em.fork()).organizations);
    const foreign = await createPersistenceRepositories(orm.em.fork()).organizations.getOrCreate({ id: randomUUID(), slug: "foreign",
      name: "Foreign", createdAt: new Date(), updatedAt: new Date() });
    const registry = new DatabaseAgentRegistry({ orm, environmentUrls: () => [], legacyFilePath: join(directory, "absent") });
    const agent = await registry.add("https://fixture.example.test/card");
    const otherAgent = await registry.add("https://other.example.test/card");

    const task = async (state = "TASK_STATE_INPUT_REQUIRED", agentId = agent.id) => {
      const id = randomUUID();
      await orm.em.getConnection().execute(
        "insert into tasks (id, organization_id, agent_id, tenant, remote_task_id, remote_context_id, kind, state, created_at, updated_at) values (?, ?, ?, '', ?, 'ctx-1', 'task', ?, now(), now())",
        [id, org.id, agentId, `remote-${id}`, state]);
      return id;
    };
    const person = (subject: string, role: "admin" | "operator" | "viewer", organizationId = org.id) =>
      provisionIdentity(orm.em.fork(), { issuer: "https://idp.example.test", subject, displayName: subject, organizationId, role });
    const admin = await person("admin", "admin");
    const op1 = await person("op1", "operator");
    const op2 = await person("op2", "operator");
    const unscoped = await person("unscoped", "operator");
    const viewer = await person("viewer", "viewer");
    const outsider = await person("outsider", "operator", foreign.id);
    await orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: op1.membershipId, agentId: agent.id, skillId: null, permission: "operate" }));
    await orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: op2.membershipId, agentId: agent.id, skillId: null, permission: "operate" }));

    let now = new Date();
    const clock = { now: () => now };
    const service = new DecisionService(decisionUnitOfWork({ orm, store }), clock);
    const as = <T>(principal: Principal, work: () => Promise<T>) => withPrincipal(principal, work);
    const open = (principal: Principal, taskId: string, key: string, text = "Delete the staging cluster", extra: object = {}) =>
      as(principal, () => service.open({ principal, taskId, requestKey: key, title: "Approve cleanup", summary: "Agent wants to proceed", risk: "high",
        action: action(text), expiresAt: new Date(now.getTime() + HOUR), ...extra }));
    const decide = (principal: Principal, requestId: string, input: Partial<Parameters<DecisionService["decide"]>[0]> & { key: string }) =>
      as(principal, () => service.decide({ principal, requestId, outcome: "approve", rationale: "", expectedRevision: 1, idempotencyKey: input.key, ...input }));
    const commandCount = () => orm.em.fork().count(TaskCommandEntity, { idempotencyKey: { $like: "decision:%" } });

    // --- Opening is scoped, validated and idempotent.
    const t1 = await task();
    await expect(open(viewer, t1, "v")).rejects.toMatchObject({ status: 403 });
    await expect(open(unscoped, t1, "u")).rejects.toMatchObject({ status: 404 });
    await expect(open(outsider, t1, "o")).rejects.toMatchObject({ status: 404 });
    await expect(open(admin, t1, "past", "x", { expiresAt: new Date(now.getTime() - 1) })).rejects.toMatchObject({ status: 400 });
    await expect(open(admin, t1, "far", "x", { expiresAt: new Date(now.getTime() + 40 * 24 * HOUR) })).rejects.toMatchObject({ status: 400 });
    await expect(open(admin, t1, "bad-assignee", "x", { assignedMembershipId: unscoped.membershipId })).rejects.toMatchObject({ status: 422 });
    await expect(open(admin, await task("TASK_STATE_COMPLETED"), "done")).rejects.toMatchObject({ status: 409 });
    const [first, again] = await Promise.all([open(admin, t1, "k1"), open(admin, t1, "k1")]);
    expect([first.request.id === again.request.id, [first.created, again.created].sort()]).toEqual([true, [false, true]]);
    await expect(open(admin, t1, "k1", "A different action")).rejects.toMatchObject({ status: 409 });
    const r1 = first.request;
    expect(r1).toMatchObject({ status: "pending", agentId: agent.id, tenant: "", currentRevision: 1, risk: "high" });
    // Scope comes from the task; the request cannot be re-pointed.
    expect(await orm.em.fork().count(DecisionRevisionEntity, { requestId: r1.id })).toBe(1);

    // --- Decision authority: separation of duties, grants, outcome policy, stale revisions.
    await expect(decide(admin, r1.id, { key: "self" })).rejects.toMatchObject({ status: 403 });
    await expect(decide(viewer, r1.id, { key: "viewer" })).rejects.toMatchObject({ status: 403 });
    await expect(decide(unscoped, r1.id, { key: "unscoped" })).rejects.toMatchObject({ status: 404 });
    await expect(decide(outsider, r1.id, { key: "outsider" })).rejects.toMatchObject({ status: 404 });
    await expect(decide(op1, r1.id, { key: "reject-no-reason", outcome: "reject" })).rejects.toMatchObject({ status: 400 });
    await expect(decide(op1, r1.id, { key: "stale", expectedRevision: 2 })).rejects.toMatchObject({ status: 409 });
    expect(await commandCount()).toBe(0);

    // --- Concurrent and repeated approvals dispatch exactly once.
    const outcomes = await Promise.allSettled([decide(op1, r1.id, { key: "a1" }), decide(op2, r1.id, { key: "a2" }), decide(op1, r1.id, { key: "a1" })]);
    const decided = outcomes.flatMap((o) => o.status === "fulfilled" && o.value.kind === "decided" ? [o.value] : []);
    expect(decided.filter((d) => !d.replay)).toHaveLength(1);
    // Whoever wins the row lock decides; every loser is refused (or replays the winner's key), never a second dispatch.
    expect(outcomes.filter((o) => o.status === "rejected").every((o) => (o as PromiseRejectedResult).reason?.status === 409)).toBe(true);
    expect(decided.length + outcomes.filter((o) => o.status === "rejected").length).toBe(3);
    const winner = decided.find((d) => !d.replay)!;
    expect(await commandCount()).toBe(1);
    expect(await orm.em.fork().count(DecisionExecutionEntity, {})).toBe(1);
    const winnerKey = winner.decision.idempotencyKey;
    const replay = await decide(winner.decision.reviewerMembershipId === op1.membershipId ? op1 : op2, r1.id, { key: winnerKey });
    expect(replay).toMatchObject({ kind: "decided", replay: true });
    expect(replay.kind === "decided" && replay.decision.id).toBe(winner.decision.id);
    expect(await commandCount()).toBe(1);
    await expect(decide(winner.decision.reviewerMembershipId === op1.membershipId ? op1 : op2, r1.id, { key: winnerKey, outcome: "reject", rationale: "changed" })).rejects.toMatchObject({ status: 409 });
    await expect(decide(op1, r1.id, { key: "later" })).rejects.toMatchObject({ status: 409 });

    // The approved revision, decision, command and message identity are all the same exact content.
    const stored = await as(admin, () => readDecision(r1.id, { orm, store }));
    expect(stored!.request.status).toBe("approved");
    const rev1 = stored!.revisions[0]!;
    expect(stored!.decisions).toHaveLength(1);
    expect(stored!.decisions[0]).toMatchObject({ outcome: "approve", revisionId: rev1.id, revisionDigest: rev1.digest });
    const execution = stored!.executions[0]!;
    expect(execution).toMatchObject({ revisionId: rev1.id, revisionDigest: rev1.digest, status: "pending", messageId: `decision-${winner.decision.id}` });
    const command = await orm.em.fork().findOneOrFail(TaskCommandEntity, { id: execution.commandId });
    expect(command).toMatchObject({ messageId: execution.messageId, action: "send", agentId: agent.id, idempotencyKey: `decision:${winner.decision.id}` });
    const payload = await store.get(org.id, command.payloadObjectKey.split("/")[1]!);
    expect(JSON.parse(Buffer.from(payload!).toString("utf8"))).toMatchObject({ text: "Delete the staging cluster",
      taskId: expect.stringMatching(/^remote-/), contextId: "ctx-1", messageId: execution.messageId, tenant: "" });

    // Observed outcome is correlated on read once the dispatcher reports it.
    const target = await orm.em.fork().findOneOrFail(DecisionExecutionEntity, { id: execution.id });
    await orm.em.fork().nativeUpdate(TaskCommandEntity, { id: command.id }, { status: "succeeded", resultJson: { localId: t1 } });
    await orm.em.fork().nativeUpdate(TaskEntity, { id: t1 }, { state: "TASK_STATE_WORKING" });
    const observed = await as(admin, () => readDecision(r1.id, { orm, store }));
    expect(observed!.executions[0]).toMatchObject({ id: target.id, status: "succeeded", observedTaskState: "TASK_STATE_WORKING", revisionDigest: rev1.digest });

    // --- Audit alone identifies who decided what, and when.
    const audit = await orm.em.fork().findOneOrFail(SecurityAuditEntity, { eventKey: `decision:${winner.decision.id}` });
    expect(audit).toMatchObject({ action: "decision.approve", targetId: winner.decision.id, organizationId: org.id,
      actorUserId: winner.decision.reviewerUserId });
    expect(await orm.em.fork().count(SecurityAuditEntity, { action: "decision.requested", targetId: r1.id })).toBe(1);

    // --- Immutability is enforced by the database, not only by the service.
    const sql = (text: string, args: unknown[] = []) => orm.em.getConnection().execute(text, args);
    await expect(sql("update decisions set rationale = 'forged' where id = ?", [winner.decision.id])).rejects.toThrow(/immutable/);
    await expect(sql("delete from decisions where id = ?", [winner.decision.id])).rejects.toThrow(/immutable/);
    await expect(sql("update decision_revisions set digest = repeat('0', 64) where id = ?", [rev1.id])).rejects.toThrow(/immutable/);
    await expect(sql("delete from decision_revisions where id = ?", [rev1.id])).rejects.toThrow(/immutable/);
    await expect(sql("update decision_executions set revision_digest = repeat('0', 64) where id = ?", [execution.id])).rejects.toThrow(/immutable/);
    await expect(sql("delete from decision_executions where id = ?", [execution.id])).rejects.toThrow(/immutable/);

    // --- Edit-before-approve creates a new immutable revision; the original proposal is preserved.
    const t2 = await task();
    const r2 = (await open(admin, t2, "edit")).request;
    await expect(decide(op1, r2.id, { key: "noop-edit", outcome: "edit", rationale: "same", edit: action("Delete the staging cluster") })).rejects.toMatchObject({ status: 422 });
    const edited = await decide(op1, r2.id, { key: "edit", outcome: "edit", rationale: "Keep the data volume", edit: action("Delete the cluster but keep the volume") });
    if (edited.kind !== "decided") throw new Error("expected decision");
    const editedDetail = (await as(op1, () => readDecision(r2.id, { orm, store })))!;
    expect(editedDetail.revisions.map((r) => [r.number, r.action.kind === "send_message" ? r.action.text : "", r.authorType])).toEqual([
      [1, "Delete the staging cluster", "user"], [2, "Delete the cluster but keep the volume", "user"]]);
    expect(editedDetail.revisions[1]!.authorUserId).toBe(op1.userId);
    expect(editedDetail.decisions[0]).toMatchObject({ outcome: "edit", revisionId: editedDetail.revisions[1]!.id, revisionDigest: editedDetail.revisions[1]!.digest });
    expect(editedDetail.executions[0]!.revisionDigest).toBe(editedDetail.revisions[1]!.digest);
    expect(editedDetail.request).toMatchObject({ status: "approved", currentRevision: 2 });

    // --- A new revision invalidates earlier review; reject/request-changes never dispatch.
    const t3 = await task();
    const r3 = (await open(admin, t3, "revise")).request;
    const dispatched = await commandCount();
    expect((await as(admin, () => service.revise({ principal: admin, requestId: r3.id, expectedRevision: 1, action: action("Narrower action") }))).request.currentRevision).toBe(2);
    await expect(decide(op1, r3.id, { key: "old-view" })).rejects.toMatchObject({ status: 409 });
    const changes = await decide(op1, r3.id, { key: "changes", expectedRevision: 2, outcome: "request_changes", rationale: "Add a rollback plan" });
    expect(changes).toMatchObject({ kind: "decided", execution: null, request: { status: "changes_requested" } });
    await expect(decide(op2, r3.id, { key: "too-soon", expectedRevision: 2 })).rejects.toMatchObject({ status: 409 });
    await as(admin, () => service.revise({ principal: admin, requestId: r3.id, expectedRevision: 2, action: action("Narrower action with rollback") }));
    const rejected = await decide(op2, r3.id, { key: "no", expectedRevision: 3, outcome: "reject", rationale: "Too risky" });
    expect(rejected).toMatchObject({ kind: "decided", execution: null, request: { status: "rejected" } });
    expect(await commandCount()).toBe(dispatched);

    // --- Delegation reassigns without deciding; only the delegate (or an admin) may then decide.
    const t4 = await task();
    const r4 = (await open(admin, t4, "delegate", "Rotate keys", { assignedMembershipId: op1.membershipId })).request;
    await expect(decide(op2, r4.id, { key: "not-mine" })).rejects.toMatchObject({ status: 403 });
    await expect(decide(op1, r4.id, { key: "to-self", outcome: "delegate", rationale: "me", delegateMembershipId: op1.membershipId })).rejects.toMatchObject({ status: 422 });
    await expect(decide(op1, r4.id, { key: "to-unscoped", outcome: "delegate", rationale: "x", delegateMembershipId: unscoped.membershipId })).rejects.toMatchObject({ status: 422 });
    const delegated = await decide(op1, r4.id, { key: "delegate", outcome: "delegate", rationale: "Needs the platform lead", delegateMembershipId: op2.membershipId });
    expect(delegated).toMatchObject({ kind: "decided", execution: null, request: { status: "pending", assignedMembershipId: op2.membershipId } });
    expect((await as(op2, () => listDecisions({ mine: true }, { orm }))).map((r) => r.id)).toEqual([r4.id]);
    await expect(decide(op1, r4.id, { key: "stale-owner" })).rejects.toMatchObject({ status: 403 });
    expect(await decide(op2, r4.id, { key: "delegate-approves" })).toMatchObject({ kind: "decided", request: { status: "approved" } });

    // --- Expired and superseded approvals cannot authorize anything.
    const t5 = await task();
    const r5 = (await open(admin, t5, "expiry")).request;
    now = new Date(now.getTime() + 2 * HOUR);
    const beforeExpiry = await commandCount();
    const refused = await decide(op1, r5.id, { key: "late" });
    expect(refused).toMatchObject({ kind: "refused", reason: "expired", request: { status: "expired" } });
    await expect(decide(op1, r5.id, { key: "later" })).rejects.toMatchObject({ status: 409 });
    expect(await commandCount()).toBe(beforeExpiry);
    const t6 = await task();
    const r6 = (await open(admin, t6, "sweep")).request;
    now = new Date(now.getTime() + 2 * HOUR);
    expect(await service.expireDue()).toBeGreaterThanOrEqual(1);
    expect((await as(admin, () => readDecision(r6.id, { orm, store })))!.request.status).toBe("expired");

    const t7 = await task();
    const old = (await open(admin, t7, "old")).request;
    const replacement = (await open(admin, t7, "new", "Newer proposal")).request;
    expect((await as(admin, () => readDecision(old.id, { orm, store })))!.request.status).toBe("superseded");
    await expect(decide(op1, old.id, { key: "on-old" })).rejects.toMatchObject({ status: 409 });
    const t8 = await task();
    const r8 = (await open(admin, t8, "task-ends")).request;
    await orm.em.fork().nativeUpdate(TaskEntity, { id: t8 }, { state: "TASK_STATE_COMPLETED" });
    expect(await decide(op1, r8.id, { key: "after-end" })).toMatchObject({ kind: "refused", reason: "superseded" });
    expect(await orm.em.fork().count(DecisionEntity, { requestId: { $in: [r5.id, r6.id, old.id, r8.id] } })).toBe(0);

    // --- Visibility follows agent grants and organization boundaries.
    const t9 = await task("TASK_STATE_INPUT_REQUIRED", otherAgent.id);
    const hidden = (await open(admin, t9, "hidden")).request;
    expect(await as(op1, () => readDecision(hidden.id, { orm, store }))).toBeUndefined();
    expect((await as(op1, () => listDecisions({}, { orm }))).map((r) => r.id)).not.toContain(hidden.id);
    expect((await as(admin, () => listDecisions({}, { orm }))).map((r) => r.id)).toContain(hidden.id);
    expect(await as(outsider, () => readDecision(r1.id, { orm, store }))).toBeUndefined();
    expect(await as(outsider, () => listDecisions({}, { orm }))).toEqual([]);
    await expect(decide(op1, hidden.id, { key: "hidden" })).rejects.toMatchObject({ status: 404 });
    void replacement;

    // --- Workers: expiry, supersession and delivery refresh run without any reviewer acting, and announce themselves.
    const fresh = async () => Number((await sql("select count(*)::int as c from outbox_messages where topic = 'task.freshness'"))[0].c);
    const status = async (id: string) => (await as(admin, () => readDecision(id, { orm, store })))!.request.status;
    const audits = (action: string, id: string) => orm.em.fork().count(SecurityAuditEntity, { action, targetId: id });
    const w1 = await task(); const w2 = await task(); const w3 = await task();
    const lapses = (await open(admin, w1, "lapses")).request;
    const ends = (await open(admin, w2, "ends")).request;
    const stays = (await open(admin, w3, "stays", "Still wanted")).request;
    const beforeOpen = await fresh();
    await open(admin, await task(), "announced");
    expect(await fresh()).toBe(beforeOpen + 1);
    now = new Date(now.getTime() + 90 * 60_000);
    // Everything opened above has a one-hour life, so all three are now overdue; the first sweep also sees the finished task.
    await orm.em.fork().nativeUpdate(TaskEntity, { id: w2 }, { state: "TASK_STATE_COMPLETED" });
    const stays2 = (await open(admin, w3, "stays-2", "Still wanted, newer", { expiresAt: new Date(now.getTime() + 4 * HOUR) })).request;
    const beforeSweep = await fresh();
    const sweeps = await Promise.all([service.sweep(), service.sweep()]);
    expect(sweeps.reduce((sum, result) => sum + result.expired, 0)).toBeGreaterThanOrEqual(1);
    expect(await status(lapses.id)).toBe("expired");
    expect(await status(ends.id)).toBe("expired"); // Overdue and finished: expiry is reported first.
    expect(await status(stays.id)).toBe("superseded"); // Replaced by the newer request for its task when that was opened.
    expect(await status(stays2.id)).toBe("pending");
    // Concurrent sweepers record each closure exactly once.
    expect(await audits("decision.expired", lapses.id)).toBe(1);
    expect(await audits("decision.expired", ends.id)).toBe(1);
    expect(await fresh()).toBeGreaterThan(beforeSweep);
    const quiet = await fresh();
    expect(await service.sweep()).toMatchObject({ expired: 0, superseded: 0 });
    expect(await fresh()).toBe(quiet); // A no-op pass publishes nothing.
    await expect(decide(op1, lapses.id, { key: "after-sweep" })).rejects.toMatchObject({ status: 409 });

    // A request whose task finishes while it is still within its deadline is superseded by the worker.
    const w4 = await task();
    const finishing = (await open(admin, w4, "finishing", "Wrap up", { expiresAt: new Date(now.getTime() + 4 * HOUR) })).request;
    await orm.em.fork().nativeUpdate(TaskEntity, { id: w4 }, { state: "TASK_STATE_CANCELED" });
    const beforeSupersede = await fresh();
    expect((await service.sweep()).superseded).toBe(1);
    expect(await status(finishing.id)).toBe("superseded");
    expect(await audits("decision.superseded", finishing.id)).toBe(1);
    expect(await fresh()).toBeGreaterThan(beforeSupersede);
    expect((await service.sweep()).superseded).toBe(0);

    // In-flight deliveries are refreshed by the worker until the task outcome is final.
    const w5 = await task();
    const delivering = (await open(admin, w5, "delivering", "Go", { expiresAt: new Date(now.getTime() + 4 * HOUR) })).request;
    const approvedResult = await decide(op1, delivering.id, { key: "deliver" });
    if (approvedResult.kind !== "decided" || !approvedResult.execution) throw new Error("expected execution");
    const executionRow = () => orm.em.fork().findOneOrFail(DecisionExecutionEntity, { id: approvedResult.execution!.id });
    expect(await service.sweep()).toMatchObject({ refreshed: 0 }); // Still queued: nothing changed, nothing announced.
    expect((await executionRow()).status).toBe("pending");
    await orm.em.fork().nativeUpdate(TaskCommandEntity, { id: approvedResult.execution.commandId }, { status: "succeeded", resultJson: { localId: w5 } });
    await orm.em.fork().nativeUpdate(TaskEntity, { id: w5 }, { state: "TASK_STATE_WORKING" });
    const beforeRefresh = await fresh();
    expect((await service.sweep()).refreshed).toBeGreaterThanOrEqual(1);
    expect(await executionRow()).toMatchObject({ status: "succeeded", observedTaskState: "TASK_STATE_WORKING" });
    expect(await fresh()).toBeGreaterThan(beforeRefresh);
    await orm.em.fork().nativeUpdate(TaskEntity, { id: w5 }, { state: "TASK_STATE_COMPLETED" });
    await service.sweep();
    expect(await executionRow()).toMatchObject({ observedTaskState: "TASK_STATE_COMPLETED" });
    const settled = await fresh();
    expect((await service.sweep()).refreshed).toBe(0); // Final outcome: no further refresh work or signals.
    expect(await fresh()).toBe(settled);
    // The decision itself never changes because of what the agent later does.
    expect((await as(admin, () => readDecision(delivering.id, { orm, store })))!.request.status).toBe("approved");

    // --- Structured replies (ADR 0015 addendum): validated values for a pinned form, sent as one JSON data part.
    const form = { title: "Deploy request", order: ["environment", "replicas"], schema: { type: "object", required: ["environment", "replicas"], properties: {
      environment: { type: "string", title: "Environment", enum: ["staging", "production"] }, replicas: { type: "integer", minimum: 1, maximum: 10 } } } };
    const dataAction = (values: object, pinned: object = form) => ({ kind: "send_data", form: pinned, values }) as unknown as ProposedAction;
    const openData = (principal: Principal, taskId: string, key: string, values: object, pinned?: object) =>
      as(principal, () => service.open({ principal, taskId, requestKey: key, title: "Approve deploy", summary: "", risk: "high",
        action: dataAction(values, pinned), expiresAt: new Date(now.getTime() + HOUR) }));
    const w6 = await task();
    await expect(openData(admin, w6, "bad-form", {}, { schema: { type: "object", properties: { n: { type: "object" } } } })).rejects.toMatchObject({ status: 400 });
    await expect(openData(admin, w6, "extra", { environment: "staging", replicas: 2, sneaky: true })).rejects.toMatchObject({ status: 400 });
    await expect(openData(admin, w6, "range", { environment: "staging", replicas: 99 })).rejects.toMatchObject({ status: 400 });
    await expect(openData(admin, w6, "missing", { environment: "staging" })).rejects.toMatchObject({ status: 400 });
    await expect(openData(admin, w6, "enum", { environment: "dev", replicas: 2 })).rejects.toMatchObject({ status: 400 });
    const structured = await openData(admin, w6, "structured", { environment: "staging", replicas: "2" });
    expect(structured.request.kind).toBe("send_data");
    const sRev1 = (await as(admin, () => readDecision(structured.request.id, { orm, store })))!.revisions[0]!;
    expect(sRev1.action).toMatchObject({ kind: "send_data", form, values: { environment: "staging", replicas: 2 } }); // Coerced to the declared type.
    // A reviewer's edit may change values but never the form or the kind; a revision cannot change the kind either.
    await expect(decide(op1, structured.request.id, { key: "form-edit", outcome: "edit", rationale: "x", edit: dataAction({ environment: "staging", replicas: 3 }, { ...form, title: "Other" }) })).rejects.toMatchObject({ status: 422 });
    await expect(decide(op1, structured.request.id, { key: "kind-edit", outcome: "edit", rationale: "x", edit: action("text instead") })).rejects.toMatchObject({ status: 422 });
    await expect(as(admin, () => service.revise({ principal: admin, requestId: structured.request.id, action: action("text"), expectedRevision: 1 }))).rejects.toMatchObject({ status: 422 });
    await expect(decide(op1, structured.request.id, { key: "bad-edit", outcome: "edit", rationale: "x", edit: dataAction({ environment: "staging", replicas: 99 }) })).rejects.toMatchObject({ status: 400 });
    const dataEdit = await decide(op1, structured.request.id, { key: "values-edit", outcome: "edit", rationale: "Smaller production rollout", edit: dataAction({ environment: "production", replicas: 3 }) });
    if (dataEdit.kind !== "decided" || !dataEdit.execution) throw new Error("expected execution");
    const sDetail = (await as(admin, () => readDecision(structured.request.id, { orm, store })))!;
    expect(sDetail.revisions.map((r) => r.number)).toEqual([1, 2]);
    expect(sDetail.revisions[1]!.digest).not.toBe(sRev1.digest);
    expect(sDetail.executions[0]).toMatchObject({ revisionId: sDetail.revisions[1]!.id, revisionDigest: sDetail.revisions[1]!.digest });
    // The dispatched command carries exactly one JSON data part (never flattened text) and the approved revision's identity.
    const sCommand = await orm.em.fork().findOneOrFail(TaskCommandEntity, { id: dataEdit.execution.commandId });
    const sPayload = JSON.parse(Buffer.from((await store.get(org.id, sCommand.payloadObjectKey.split("/")[1]!))!).toString("utf8"));
    expect(sPayload.parts).toEqual([{ data: { environment: "production", replicas: 3 }, mediaType: "application/json" }]);
    expect(sPayload.text).toBeUndefined();
    expect(sPayload.metadata.approval).toEqual({ requestId: structured.request.id, decisionId: dataEdit.decision.id, revision: 2, revisionDigest: sDetail.revisions[1]!.digest });
    // Text approvals now carry the same identity.
    const textPayload = JSON.parse(Buffer.from((await store.get(org.id, command.payloadObjectKey.split("/")[1]!))!).toString("utf8"));
    expect(textPayload.metadata.approval).toMatchObject({ requestId: r1.id, revision: 1, revisionDigest: rev1.digest });

    // --- Agent-originated requests (ADR 0023): no requester, authored by the agent, validated before any write.
    const fromAgent = (taskId: string, key: string, extra: Record<string, unknown> = {}) => orm.em.fork().transactional((tx) =>
      service.openFromAgent(decisionPorts(tx, store), { organizationId: org.id, taskId, requestKey: key, title: "Agent asks", summary: "Needs a person", risk: "high",
        action: action("Proceed with the deletion"), lifetimeMs: HOUR, ...extra }));
    const w7 = await task();
    const operatorRequest = (await open(admin, w7, "operator-first", "Operator proposal")).request;
    const agentRequest = await fromAgent(w7, "agent:w7:m1");
    expect(agentRequest.created).toBe(true);
    expect(agentRequest.request).toMatchObject({ requesterUserId: null, kind: "send_message", status: "pending", assignedMembershipId: null, currentRevision: 1 });
    expect(agentRequest.request.expiresAt.getTime()).toBe(now.getTime() + HOUR);
    const agentDetail = (await as(admin, () => readDecision(agentRequest.request.id, { orm, store })))!;
    expect(agentDetail.revisions[0]).toMatchObject({ authorType: "agent", authorUserId: null });
    const requestedAudit = await orm.em.fork().findOneOrFail(SecurityAuditEntity, { eventKey: `decision-requested:${agentRequest.request.id}` });
    expect(requestedAudit).toMatchObject({ action: "decision.requested", actorUserId: null, actorType: "agent" });
    expect((await as(admin, () => readDecision(operatorRequest.id, { orm, store })))!.request.status).toBe("superseded"); // One live approval per task.
    // Idempotent per key; the same key for different content is refused.
    expect((await fromAgent(w7, "agent:w7:m1"))).toMatchObject({ created: false, request: { id: agentRequest.request.id } });
    await expect(fromAgent(w7, "agent:w7:m1", { action: action("Something else") })).rejects.toMatchObject({ status: 409 });
    // Refusals happen before any write: nothing is stored for invalid content, a finished or unknown task, or a bad key.
    const before = await orm.em.fork().count(DecisionRevisionEntity, {});
    await expect(fromAgent(w7, "k-risk", { risk: "extreme" })).rejects.toMatchObject({ status: 400 });
    await expect(fromAgent(w7, "k-title", { title: "  " })).rejects.toMatchObject({ status: 400 });
    await expect(fromAgent(w7, "", {})).rejects.toMatchObject({ status: 400 });
    await expect(fromAgent(w7, "k-form", { action: dataAction({ environment: "staging" }, { schema: { type: "object", properties: { n: { type: "object" } } } }) })).rejects.toMatchObject({ status: 400 });
    await expect(fromAgent(await task("TASK_STATE_COMPLETED"), "k-done")).rejects.toMatchObject({ status: 409 });
    await expect(fromAgent(randomUUID(), "k-none")).rejects.toMatchObject({ status: 409 });
    expect(await orm.em.fork().count(DecisionRevisionEntity, {})).toBe(before);
    // A structured request from the agent works the same way and is approved by a person, never by the agent.
    const w8 = await task();
    const agentData = await fromAgent(w8, "agent:w8:m1", { action: dataAction({ environment: "production", replicas: 2 }) });
    expect(agentData.request.kind).toBe("send_data");
    const approved = await decide(admin, agentData.request.id, { key: "agent-approve", outcome: "approve", rationale: "ok" });
    if (approved.kind !== "decided" || !approved.execution) throw new Error("expected execution");
    expect(approved.decision.reviewerUserId).toBe(admin.userId);
    const approvedCommand = await orm.em.fork().findOneOrFail(TaskCommandEntity, { id: approved.execution.commandId });
    const approvedPayload = JSON.parse(Buffer.from((await store.get(org.id, approvedCommand.payloadObjectKey.split("/")[1]!))!).toString("utf8"));
    expect(approvedPayload.parts).toEqual([{ data: { environment: "production", replicas: 2 }, mediaType: "application/json" }]);
    expect(approvedPayload.metadata.approval).toMatchObject({ requestId: agentData.request.id, decisionId: approved.decision.id });

    // --- Everything survives a restart.
    await orm.close(true); orm = await createDatabaseOrm(config);
    const reopened = await withPrincipal(admin, () => readDecision(r1.id, { orm, store }));
    expect(reopened!.decisions[0]!.id).toBe(winner.decision.id);
    expect(reopened!.executions[0]!.revisionDigest).toBe(rev1.digest);

    // Rolling back removes the aggregate and a re-apply restores the same schema.
    await orm.migrator.down();
    await orm.migrator.up();
    expect(await orm.migrator.checkSchema()).toBe(false);
  } finally { await orm.close(true); }
}

async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-decisions-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("HITL-003/004 AUD-001 PGlite decisions", () => {
  it("verifies typed scoped expiring decisions, exact-revision execution correlation and immutability", async () => {
    await temporary((directory) => contract({ profile: "pglite", dataDir: join(directory, "db") }, directory));
  });
});
const postgresUrl = process.env.A2A_TEST_POSTGRES_URL;
if (process.env.CI === "true" && !postgresUrl) throw new Error("CI must set A2A_TEST_POSTGRES_URL");
if (postgresUrl && !decodeURIComponent(new URL(postgresUrl).pathname).includes("test")) throw new Error("A2A_TEST_POSTGRES_URL must target a test database");
(postgresUrl ? describe : describe.skip)("TST-001 PostgreSQL decisions", () => {
  it("passes the same decision contract", async () => {
    await temporary((directory) => contract({ profile: "postgresql", url: postgresUrl! }, directory));
  });
});
