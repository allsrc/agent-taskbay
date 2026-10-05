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
import { SecurityAuditEntity, TaskEntity, DecisionRequestEntity } from "./entities";
import { withPrincipal } from "../auth/principal-context";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { bootstrapDefaultLocalOrganization } from "../../application/services/bootstrap-default-organization";
import { DecisionService } from "../../application/services/decisions";
import { TaskWorkflowService } from "../../application/services/task-workflow";
import { decisionUnitOfWork } from "../../runtime/decisions";
import { workflowUnitOfWork } from "../../runtime/workflow";
import { auditCsv, createAuditService, csvCell, parseAuditQuery } from "../../runtime/audit";
import type { Principal } from "../../application/ports/identity";
import type { AuditGroup } from "../../application/ports/audit";

const HOUR = 3_600_000;

async function contract(config: DatabaseConfig, directory: string) {
  let orm = await createDatabaseOrm(config);
  const store = new FilesystemArtifactStore(join(directory, "artifacts"));
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    expect(await orm.migrator.checkSchema()).toBe(false);
    const org = await bootstrapDefaultLocalOrganization(createPersistenceRepositories(orm.em.fork()).organizations);
    const foreign = await createPersistenceRepositories(orm.em.fork()).organizations.getOrCreate({ id: randomUUID(), slug: "foreign", name: "Foreign", createdAt: new Date(), updatedAt: new Date() });
    const registry = new DatabaseAgentRegistry({ orm, environmentUrls: () => [], legacyFilePath: join(directory, "absent") });
    const agent = await registry.add("https://fixture.example.test/card");
    const hiddenAgent = await registry.add("https://hidden.example.test/card");
    const task = async (agentId = agent.id, state = "TASK_STATE_INPUT_REQUIRED") => {
      const id = randomUUID();
      await orm.em.getConnection().execute(
        "insert into tasks (id, organization_id, agent_id, tenant, remote_task_id, remote_context_id, kind, state, title, created_at, updated_at) values (?, ?, ?, '', ?, 'ctx', 'task', ?, ?, now(), now())",
        [id, org.id, agentId, `remote-${id}`, state, "Clean up"]);
      return id;
    };
    const person = (subject: string, role: "admin" | "operator" | "viewer", organizationId = org.id) =>
      provisionIdentity(orm.em.fork(), { issuer: "https://idp.example.test", subject, displayName: subject, organizationId, role });
    const admin = await person("admin", "admin"); const op1 = await person("op1", "operator"); const op2 = await person("op2", "operator");
    const unscoped = await person("unscoped", "operator"); const viewer = await person("viewer", "viewer"); const outsider = await person("outsider", "operator", foreign.id);
    for (const [member, permission] of [[op1, "operate"], [op2, "operate"], [viewer, "read"]] as const)
      await orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: member.membershipId, agentId: agent.id, skillId: null, permission }));

    let now = new Date();
    const clock = { now: () => now };
    const decisions = new DecisionService(decisionUnitOfWork({ orm, store }), clock);
    const workflow = new TaskWorkflowService(workflowUnitOfWork({ orm }), clock);
    const audit = createAuditService({ orm });
    const as = <T>(principal: Principal, work: () => Promise<T>) => withPrincipal(principal, work);
    const open = (taskId: string, key: string, text: string, extra: object = {}) => as(admin, () => decisions.open({ principal: admin, taskId, requestKey: key, title: `Approve ${key}`,
      summary: "Needs sign-off", risk: "high", action: { kind: "send_message", text }, expiresAt: new Date(now.getTime() + HOUR), ...extra }));
    const decide = (principal: Principal, requestId: string, key: string, input: object = {}) => as(principal, () => decisions.decide({ principal, requestId, outcome: "approve",
      rationale: "", expectedRevision: 1, idempotencyKey: key, ...input } as Parameters<DecisionService["decide"]>[0]));
    const page = (principal: Principal, query: { taskId?: string; group?: AuditGroup; actorUserId?: string; since?: Date; until?: Date; cursor?: string; limit?: number } = {}) =>
      as(principal, () => audit.page(principal, { limit: 200, ...query }));
    const sql = (text: string, args: unknown[] = []) => orm.em.getConnection().execute(text, args);
    const tick = () => { now = new Date(now.getTime() + 1000); };

    // --- Generate every kind of fact through the real services.
    const t1 = await task(); const t2 = await task(); const t3 = await task(); const hidden = await task(hiddenAgent.id);
    const approved = (await open(t1, "approved", "Delete staging-old")).request; tick();
    const approval = await decide(op1, approved.id, "approve-1", { rationale: "Looks right" });
    if (approval.kind !== "decided") throw new Error("expected decision");
    tick();
    const edited = (await open(t2, "edited", "Rotate every key")).request; tick();
    await decide(op2, edited.id, "edit-1", { outcome: "edit", rationale: "Keep the read-only key", edit: { kind: "send_message", text: "Rotate every key except read-only" } }); tick();
    const rejected = (await open(t3, "rejected", "Disable alerts")).request; tick();
    await as(admin, () => decisions.revise({ principal: admin, requestId: rejected.id, expectedRevision: 1, action: { kind: "send_message", text: "Disable noisy alerts" } })); tick();
    await decide(op1, rejected.id, "reject-1", { outcome: "reject", rationale: "Still too broad", expectedRevision: 2 }); tick();
    const lapses = (await open(await task(), "lapses", "Never decided")).request; tick();
    const shared = await task();
    const replaced = (await open(shared, "old", "Old")).request; tick();
    await open(shared, "new", "Newer"); tick();
    expect(replaced.id).toBeTruthy();
    now = new Date(now.getTime() + 2 * HOUR);
    await decisions.sweep();
    const owned = await task();
    await as(op1, () => workflow.claim(op1, owned)); tick();
    await as(op1, () => workflow.assign(op1, owned, op2.membershipId)); tick();
    await as(op2, () => workflow.setDue(op2, owned, new Date(now.getTime() + HOUR))); tick();
    const secret = "Contract number 4471-private";
    await as(op2, () => workflow.addNote(op2, owned, { body: secret, noteKey: randomUUID() })); tick();
    await as(admin, () => workflow.release(admin, owned)); tick();
    await open(hidden, "hidden", "Restricted action");

    // --- Org-wide trail: administrators only, newest first, nothing repeated, nothing missing.
    const all = await page(admin);
    expect(all.next).toBeNull();
    const keys = all.entries.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(all.entries.map((entry) => entry.at.getTime())).toEqual([...all.entries.map((entry) => entry.at.getTime())].sort((a, b) => b - a));
    for (const denied of [op1, viewer, unscoped]) await expect(page(denied)).rejects.toMatchObject({ status: 403 });
    expect((await page(outsider, { taskId: t1 }).catch((error) => error)).status).toBe(404);
    expect((await as(outsider, () => audit.page(outsider, { limit: 10 })).catch((error) => error)).status).toBe(403);
    const kinds = new Set(all.entries.map((entry) => entry.kind));
    for (const kind of ["decision.requested", "decision.revised", "decision.approve", "decision.edit", "decision.reject", "decision.expired", "decision.superseded",
      "task.claimed", "task.assigned", "task.due_set", "task.released", "task.note_added", "task.send.accepted", "access.granted", "identity.provisioned"]) expect(kinds.has(kind), kind).toBe(true);

    // --- The record alone says who decided exactly what, when and why.
    const approve = all.entries.find((entry) => entry.kind === "decision.approve")!;
    expect(approve.actorUserId).toBe(op1.userId);
    expect(all.people[approve.actorUserId!]).toBe("op1");
    expect(approve.data).toMatchObject({ title: "Approve approved", rationale: "Looks right", revision: 1, text: "Delete staging-old", delivery: "pending", messageId: `decision-${approval.decision.id}` });
    expect(approve.data.digest).toBe(approval.decision.revisionDigest);
    expect(approve.taskId).toBe(t1);
    expect(all.context[t1]).toMatchObject({ title: "Clean up", agentName: expect.any(String) });
    const edit = all.entries.find((entry) => entry.kind === "decision.edit")!;
    expect(edit).toMatchObject({ actorUserId: op2.userId, data: { revision: 2, text: "Rotate every key except read-only", rationale: "Keep the read-only key" } });
    const editRevision = all.entries.find((entry) => entry.kind === "decision.revised" && entry.subjectId === edited.id)!;
    expect(editRevision).toMatchObject({ actorUserId: op2.userId, data: { revision: 2 } }); // The edit's new revision is attributed to the reviewer.
    expect(all.entries.find((entry) => entry.kind === "decision.requested" && entry.subjectId === approved.id)).toMatchObject({ actorUserId: admin.userId, data: { text: "Delete staging-old", risk: "high" } });
    const expired = all.entries.find((entry) => entry.kind === "decision.expired" && entry.subjectId === lapses.id)!;
    expect(expired.actorUserId).toBeNull();
    // Ownership: who, from whom, to whom; notes show that one exists, never what it says.
    const assigned = all.entries.find((entry) => entry.kind === "task.assigned")!;
    expect(assigned).toMatchObject({ actorUserId: op1.userId, data: { fromMembershipId: op1.membershipId, toMembershipId: op2.membershipId } });
    expect(all.people[op2.membershipId]).toBe("op2");
    expect(JSON.stringify(all)).not.toContain(secret);

    // --- Completeness: every audited decision/ownership action has its timeline entry, and no entry is invented.
    const facts = await orm.em.fork().find(SecurityAuditEntity, { action: { $like: "decision.%" } });
    for (const fact of facts.filter((candidate) => ["decision.requested", "decision.revised", "decision.approve", "decision.edit", "decision.reject"].includes(candidate.action))) {
      const matched = all.entries.filter((entry) => entry.kind === fact.action && entry.actorUserId === fact.actorUserId);
      expect(matched.length, fact.action).toBeGreaterThan(0);
    }
    const counts = (rows: Array<{ kind?: string; action?: string }>, name: string) => rows.filter((row) => (row.kind ?? row.action) === name).length;
    for (const name of ["decision.requested", "decision.revised", "decision.approve", "decision.edit", "decision.reject", "decision.expired", "decision.superseded", "task.claimed", "task.assigned", "task.due_set", "task.released", "task.note_added"]) {
      // An edit's new revision is audited by the edit decision itself, so revisions = revise facts + edit facts.
      const audited = counts(await orm.em.fork().find(SecurityAuditEntity, { action: name }), name) +
        (name === "decision.revised" ? counts(await orm.em.fork().find(SecurityAuditEntity, { action: "decision.edit" }), "decision.edit") : 0);
      expect(counts(all.entries, name), name).toBe(audited);
    }

    // --- Filters, paging and read-only behavior.
    const approvals = await page(admin, { group: "approvals" });
    expect(approvals.entries.every((entry) => entry.kind.startsWith("decision."))).toBe(true);
    const ownership = await page(admin, { group: "ownership" });
    expect(ownership.entries.length).toBeGreaterThanOrEqual(5);
    expect(ownership.entries.every((entry) => entry.kind.startsWith("task.") && !entry.kind.includes("send"))).toBe(true);
    const commands = await page(admin, { group: "commands" });
    expect(commands.entries.length).toBeGreaterThanOrEqual(1);
    const access = await page(admin, { group: "access" });
    expect(access.entries.some((entry) => entry.kind === "access.granted")).toBe(true);
    expect(access.entries.every((entry) => !entry.kind.startsWith("decision.") && entry.taskId === null)).toBe(true);
    expect((await page(admin, { actorUserId: op1.userId })).entries.every((entry) => entry.actorUserId === op1.userId)).toBe(true);
    const mid = all.entries[Math.floor(all.entries.length / 2)]!;
    expect((await page(admin, { since: mid.at })).entries.every((entry) => entry.at >= mid.at)).toBe(true);
    expect((await page(admin, { until: mid.at })).entries.every((entry) => entry.at <= mid.at)).toBe(true);
    const paged = []; let cursor: string | undefined;
    do { const next = await page(admin, { limit: 7, cursor }); paged.push(...next.entries); cursor = next.next ?? undefined; } while (cursor);
    expect(paged.map((entry) => entry.key)).toEqual(keys);
    await expect(page(admin, { cursor: "garbage" })).rejects.toMatchObject({ status: 400 });
    await expect(page(admin, { limit: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(page(admin, { limit: 500 })).rejects.toMatchObject({ status: 400 });
    await expect(page(admin, { since: new Date(2030, 1, 1), until: new Date(2020, 1, 1) })).rejects.toMatchObject({ status: 400 });
    const factsBefore = await orm.em.fork().count(SecurityAuditEntity, {});
    await page(admin); await page(admin, { taskId: t1 });
    expect(await orm.em.fork().count(SecurityAuditEntity, {})).toBe(factsBefore);

    // --- Per-task trails follow task visibility and never include identity or access facts.
    const trail = await page(op1, { taskId: t1 });
    expect(trail.entries.map((entry) => entry.kind)).toEqual(expect.arrayContaining(["decision.requested", "decision.approve"]));
    expect(trail.entries.every((entry) => entry.taskId === t1)).toBe(true);
    expect((await page(viewer, { taskId: t1 })).entries.length).toBe(trail.entries.length);
    expect((await page(unscoped, { taskId: t1 }).catch((error) => error)).status).toBe(404);
    expect((await page(op1, { taskId: hidden }).catch((error) => error)).status).toBe(404);
    expect((await page(admin, { taskId: hidden })).entries.length).toBeGreaterThan(0);
    expect((await page(admin, { taskId: randomUUID() }).catch((error) => error)).status).toBe(404);

    // --- Tamper resistance in the database itself.
    const fact = (await orm.em.fork().find(SecurityAuditEntity, {}, { limit: 1 }))[0]!;
    await expect(sql("update security_audit_events set action = 'forged' where id = ?", [fact.id])).rejects.toThrow(/append-only/);
    await expect(sql("delete from security_audit_events where id = ?", [fact.id])).rejects.toThrow(/append-only/);
    await expect(sql("update decision_requests set title = 'forged' where id = ?", [approved.id])).rejects.toThrow(/immutable/);
    await expect(sql("update decision_requests set expires_at = expires_at + interval '1 day' where id = ?", [approved.id])).rejects.toThrow(/immutable/);
    await expect(sql("update decision_requests set requester_user_id = ? where id = ?", [op1.userId, approved.id])).rejects.toThrow(/immutable/);
    await expect(sql("delete from decision_requests where id = ?", [approved.id])).rejects.toThrow(/immutable/);
    expect(await orm.em.fork().findOneOrFail(DecisionRequestEntity, { id: approved.id }, { refresh: true })).toMatchObject({ title: "Approve approved", status: "approved" });
    await orm.em.fork().nativeUpdate(TaskEntity, { id: t2 }, { state: "TASK_STATE_WORKING" }); // Unrelated rows stay writable.

    // --- Export neutralizes spreadsheet formulas in any text cell and quotes separators.
    const injected = (await open(await task(), "formula", "Text, with \"quotes\"", { title: "=HYPERLINK(\"http://evil.example\",\"x\")" })).request;
    const evil = await person("=SUM(1,1)", "operator");
    await orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: evil.membershipId, agentId: agent.id, skillId: null, permission: "operate" }));
    const evilTask = await task();
    await as(evil, () => workflow.claim(evil, evilTask));
    const csv = auditCsv(await page(admin));
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("time,kind,actor,task,subject,detail");
    expect(lines.some((line) => /,task\.claimed,"'=SUM\(1,1\)",/.test(line))).toBe(true); // Actor cell is defused and quoted.
    expect(lines.every((line) => !/(^|,)"?=/.test(line))).toBe(true); // No cell begins with a formula character.
    expect(csv).toContain(injected.id);
    expect(csv).toContain('\\""quotes\\""'); // JSON escapes the quote, then CSV doubles it inside the quoted detail cell.
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell(null)).toBe("");
    expect(parseAuditQuery(new URLSearchParams("group=approvals&limit=10"))).toMatchObject({ group: "approvals", limit: 10 });
    expect(() => parseAuditQuery(new URLSearchParams("group=bogus"))).toThrow();
    expect(() => parseAuditQuery(new URLSearchParams("unknown=1"))).toThrow();

    // --- Survives a restart; rollback and reapply restore the same schema.
    await orm.close(true); orm = await createDatabaseOrm(config);
    const restarted = await as(admin, () => createAuditService({ orm }).page(admin, { limit: 200 }));
    expect(restarted.entries.find((entry) => entry.kind === "decision.approve")?.data.text).toBe("Delete staging-old");
    await orm.migrator.down(); await orm.migrator.up();
    expect(await orm.migrator.checkSchema()).toBe(false);
  } finally { await orm.close(true); }
}

async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-audit-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("AUD-001/002 PGlite workflow audit", () => {
  it("verifies the unified, scoped, append-only audit trail", async () => {
    await temporary((directory) => contract({ profile: "pglite", dataDir: join(directory, "db") }, directory));
  });
});
const postgresUrl = process.env.A2A_TEST_POSTGRES_URL;
if (process.env.CI === "true" && !postgresUrl) throw new Error("CI must set A2A_TEST_POSTGRES_URL");
if (postgresUrl && !decodeURIComponent(new URL(postgresUrl).pathname).includes("test")) throw new Error("A2A_TEST_POSTGRES_URL must target a test database");
(postgresUrl ? describe : describe.skip)("TST-001 PostgreSQL workflow audit", () => {
  it("passes the same audit contract", async () => {
    await temporary((directory) => contract({ profile: "postgresql", url: postgresUrl! }, directory));
  });
});
