import { createHmac, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
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
import { AccessGrantEntity, NotificationEntity, NotificationRecipientEntity, OutboxMessageEntity, TaskEntity } from "./entities";
import { withPrincipal } from "../auth/principal-context";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { WebhookChannel, loadNotifyConfig } from "../notify/webhook-channel";
import { bootstrapDefaultLocalOrganization } from "../../application/services/bootstrap-default-organization";
import { DecisionService } from "../../application/services/decisions";
import { TaskWorkflowService } from "../../application/services/task-workflow";
import { MAX_DELIVERY_ATTEMPTS, MAX_FANOUT_ATTEMPTS, enqueueNotificationEvent } from "../../application/services/notification-fanout";
import { NOTIFICATION_TOPIC, WEBHOOK_TOPIC } from "../../application/ports/notifications";
import { decisionUnitOfWork } from "../../runtime/decisions";
import { workflowUnitOfWork } from "../../runtime/workflow";
import { channelStatus, createNotificationDelivery, createNotificationFanout, listInbox, markRead, sendTestNotification } from "../../runtime/notifications";
import type { Principal } from "../../application/ports/identity";

const HOUR = 3_600_000;
const SECRET = "s".repeat(40);

async function contract(config: DatabaseConfig, directory: string) {
  let orm = await createDatabaseOrm(config);
  const store = new FilesystemArtifactStore(join(directory, "artifacts"));
  // A real HTTP receiver for the external channel; it answers with whatever status the test sets.
  const received: Array<{ headers: IncomingMessage["headers"]; body: string }> = [];
  let status = 200;
  const receiver = createServer(async (request, response) => {
    let body = ""; for await (const chunk of request) body += chunk;
    received.push({ headers: request.headers, body }); response.statusCode = status; response.end("ok");
  });
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(receiver.address() as { port: number }).port}/hook`;
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    expect(await orm.migrator.checkSchema()).toBe(false);
    const org = await bootstrapDefaultLocalOrganization(createPersistenceRepositories(orm.em.fork()).organizations);
    const foreign = await createPersistenceRepositories(orm.em.fork()).organizations.getOrCreate({ id: randomUUID(), slug: "foreign", name: "Foreign", createdAt: new Date(), updatedAt: new Date() });
    const registry = new DatabaseAgentRegistry({ orm, environmentUrls: () => [], legacyFilePath: join(directory, "absent") });
    const agent = await registry.add("https://fixture.example.test/card");
    const task = async (state = "TASK_STATE_WORKING", title: string | null = "Clean up staging") => {
      const id = randomUUID();
      await orm.em.getConnection().execute(
        "insert into tasks (id, organization_id, agent_id, tenant, remote_task_id, remote_context_id, kind, state, title, created_at, updated_at) values (?, ?, ?, '', ?, 'ctx', 'task', ?, ?, now(), now())",
        [id, org.id, agent.id, `remote-${id}`, state, title]);
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
    const channel = new WebhookChannel({ url, secret: SECRET, organizationSlug: "local" }, "https://console.example.test");
    const realFanout = createNotificationFanout({ orm, channel });
    const decisions = new DecisionService(decisionUnitOfWork({ orm, store }), clock);
    const workflow = new TaskWorkflowService(workflowUnitOfWork({ orm }), clock);
    const as = <T>(principal: Principal, work: () => Promise<T>) => withPrincipal(principal, work);
    const drain = async () => { let ran = 0; while (await realFanout.runOne()) { ran += 1; if (ran > 60) throw new Error("fan-out did not settle: " + JSON.stringify(await orm.em.getConnection().execute("select id, status, attempts, last_error from outbox_messages where topic = 'notification.event' order by created_at desc limit 3"))); } return ran; };
    const delivery = createNotificationDelivery({ orm, channel })!;
    const sql = (text: string, args: unknown[] = []) => orm.em.getConnection().execute(text, args);
    const inbox = (principal: Principal, query: { unreadOnly?: boolean; limit?: number; cursor?: string } = {}) =>
      as(principal, () => listInbox({ unreadOnly: query.unreadOnly ?? false, limit: query.limit ?? 50, cursor: query.cursor }, { orm }));
    const kindsFor = async (principal: Principal) => (await inbox(principal)).items.map((item) => item.kind);
    const open = (taskId: string, key: string, text: string, extra: object = {}) => as(admin, () => decisions.open({ principal: admin, taskId, requestKey: key, title: `Approve ${key}`,
      summary: "Needs sign-off", risk: "high", action: { kind: "send_message", text }, expiresAt: new Date(now.getTime() + HOUR), ...extra }));
    const decide = (principal: Principal, requestId: string, key: string, input: object = {}) => as(principal, () => decisions.decide({ principal, requestId, outcome: "approve",
      rationale: "", expectedRevision: 1, idempotencyKey: key, ...input } as Parameters<DecisionService["decide"]>[0]));
    const events = () => orm.em.fork().count(OutboxMessageEntity, { topic: NOTIFICATION_TOPIC });

    // --- Raising an event is part of the change, and fan-out tells exactly the right people.
    const t1 = await task();
    const opened = (await open(t1, "first", "SECRET-PROPOSAL-TEXT delete everything")).request;
    expect(await events()).toBe(1);
    expect(await drain()).toBe(1);
    for (const told of [op1, op2]) expect(await kindsFor(told)).toEqual(["approval.requested"]);
    for (const quiet of [admin, unscoped, viewer, outsider]) expect(await kindsFor(quiet)).toEqual([]);
    const first = (await inbox(op1)).items[0]!;
    expect(first).toMatchObject({ title: "Approval needed", link: `/approvals/${opened.id}`, taskId: t1, readAt: null });
    expect(first.body).toContain("Approve first");
    expect(JSON.stringify(await inbox(op1))).not.toContain("SECRET-PROPOSAL-TEXT");
    expect((await sql("select count(*)::int as c from outbox_messages where topic = ? and status = 'processed'", [NOTIFICATION_TOPIC]))[0].c).toBe(1);

    // --- An assignee alone is told; the requester hears the outcome; delegation tells the new assignee.
    const t2 = await task();
    const assigned = (await open(t2, "assigned", "Rotate keys", { assignedMembershipId: op1.membershipId })).request; await drain();
    expect((await inbox(op1)).items.filter((item) => item.link === `/approvals/${assigned.id}`)).toHaveLength(1);
    expect((await inbox(op2)).items.filter((item) => item.link === `/approvals/${assigned.id}`)).toHaveLength(0);
    await decide(op1, assigned.id, "delegate-1", { outcome: "delegate", rationale: "Needs op2", delegateMembershipId: op2.membershipId }); await drain();
    expect((await inbox(op2)).items.find((item) => item.kind === "approval.assigned")).toMatchObject({ title: "Approval assigned to you", link: `/approvals/${assigned.id}` });
    expect(await kindsFor(op1)).not.toContain("approval.assigned"); // The actor is never told about their own act.
    await decide(op2, assigned.id, "approve-assigned"); await drain();
    const decided = (await inbox(admin)).items.find((item) => item.kind === "approval.decided")!;
    expect(decided).toMatchObject({ title: "Your request was approved" });
    expect(decided.body).toContain("op2 approved");
    const t3 = await task();
    const toReject = (await open(t3, "rejects", "Disable alerts")).request; await drain();
    await decide(op1, toReject.id, "reject-1", { outcome: "reject", rationale: "Too broad" }); await drain();
    expect((await inbox(admin)).items[0]).toMatchObject({ title: "Your request was rejected" });
    expect(JSON.stringify(await inbox(admin))).not.toContain("Too broad"); // Rationale stays out of notifications.
    const t4 = await task();
    const revisable = (await open(t4, "revises", "Scale down")).request; await drain();
    await decide(op1, revisable.id, "changes-1", { outcome: "request_changes", rationale: "Add rollback" }); await drain();
    expect((await inbox(admin)).items[0]).toMatchObject({ title: "Your request was sent back for changes" });
    await as(admin, () => decisions.revise({ principal: admin, requestId: revisable.id, expectedRevision: 1, action: { kind: "send_message", text: "Scale down with rollback" } })); await drain();
    expect(await kindsFor(op1)).toContain("approval.revised");

    // --- Expiry warning once, expiry and supersession tell the requester.
    const t5 = await task(); const t6 = await task(); const t7 = await task();
    const longLived = (await open(t5, "warns", "Warn me")).request;
    const short = (await open(t6, "short", "Too short to warn", { expiresAt: new Date(now.getTime() + 20 * 60_000) })).request; await drain();
    const old = (await open(t7, "old", "Old")).request;
    // Someone else opening a newer request supersedes it, and the requester is told (the actor never is).
    await as(op1, () => decisions.open({ principal: op1, taskId: t7, requestKey: "new", title: "Approve new", summary: "", risk: "low", action: { kind: "send_message", text: "Newer" }, expiresAt: new Date(now.getTime() + HOUR) }));
    await drain();
    expect((await inbox(admin)).items.some((item) => item.kind === "approval.superseded" && item.link === `/approvals/${old.id}`)).toBe(true);
    now = new Date(now.getTime() + 50 * 60_000);
    const sweep1 = await decisions.sweep(); await drain();
    expect(sweep1.warned).toBeGreaterThanOrEqual(1); // Every open request near its deadline, warned once each.
    const warningLinks = () => inbox(op1).then((page) => page.items.filter((item) => item.kind === "approval.expiring").map((item) => item.link));
    expect(await warningLinks()).toContain(`/approvals/${longLived.id}`);
    expect(await warningLinks()).not.toContain(`/approvals/${short.id}`); // Too short-lived for a warning to help.
    const firstWarnings = await warningLinks();
    expect(new Set(firstWarnings).size).toBe(firstWarnings.length);
    expect((await decisions.sweep()).warned).toBe(0); await drain();
    expect(await warningLinks()).toEqual(firstWarnings); // Never warned twice.
    now = new Date(now.getTime() + 2 * HOUR);
    await decisions.sweep(); await drain();
    const expiredLinks = (await inbox(admin)).items.filter((item) => item.kind === "approval.expired").map((item) => item.link);
    expect(expiredLinks).toEqual(expect.arrayContaining([`/approvals/${longLived.id}`, `/approvals/${short.id}`]));

    // --- Task ownership events.
    const o1 = await task();
    await as(op1, () => workflow.claim(op1, o1));
    expect((await inbox(op2)).items.some((item) => item.kind === "task.assigned")).toBe(false); // Claiming for yourself tells no one.
    await as(op1, () => workflow.assign(op1, o1, op2.membershipId)); await drain();
    expect((await inbox(op2)).items.find((item) => item.kind === "task.assigned")).toMatchObject({ title: "Task assigned to you", link: `/tasks/${o1}` });
    await as(admin, () => workflow.setPolicy(admin, { agentId: null, targetMembershipId: op1.membershipId, enabled: true }));
    await as(op2, () => workflow.setDue(op2, o1, new Date(now.getTime() + HOUR)));
    now = new Date(now.getTime() + 2 * HOUR);
    await workflow.sweepEscalations(); await drain();
    const escalated = (await inbox(op1)).items.find((item) => item.kind === "task.escalated")!;
    expect(escalated.title).toBe("Overdue task escalated");
    expect(escalated.body).toMatch(/moved from op2 to op1/);
    expect((await inbox(op2)).items.some((item) => item.kind === "task.escalated")).toBe(true); // The previous owner is told too.

    // --- Input needed, finished and failed: the owner, otherwise eligible reviewers (never ineligible people).
    const owned = await task(); const unowned = await task();
    await as(op1, () => workflow.claim(op1, owned));
    await orm.em.fork().transactional((tx) => enqueueNotificationEvent(createPersistenceRepositories(tx).outbox, org.id, { kind: "task.needs_input", taskId: owned, detail: "input" }, new Date())); await drain();
    await orm.em.fork().transactional((tx) => enqueueNotificationEvent(createPersistenceRepositories(tx).outbox, org.id, { kind: "task.needs_input", taskId: unowned, detail: "auth" }, new Date())); await drain();
    await orm.em.fork().transactional((tx) => enqueueNotificationEvent(createPersistenceRepositories(tx).outbox, org.id, { kind: "task.finished", taskId: unowned }, new Date())); await drain();
    await orm.em.fork().transactional((tx) => enqueueNotificationEvent(createPersistenceRepositories(tx).outbox, org.id, { kind: "task.failed", taskId: owned }, new Date())); await drain();
    const op1Items = (await inbox(op1)).items; const op2Items = (await inbox(op2)).items;
    expect(op1Items.filter((item) => item.link === `/tasks/${owned}`).map((item) => item.title).sort()).toEqual(["Input needed", "Task failed"]);
    expect(op2Items.some((item) => item.link === `/tasks/${owned}`)).toBe(false);
    expect(op2Items.find((item) => item.link === `/tasks/${unowned}`)?.title).toBe("Authorization needed");
    expect(op1Items.find((item) => item.link === `/tasks/${unowned}`)?.title).toBe("Authorization needed");
    expect(op1Items.some((item) => item.title === "Task finished")).toBe(false); // No owner, so no finished notice.
    for (const quiet of [unscoped, viewer, outsider]) expect((await inbox(quiet)).items.some((item) => item.link === `/tasks/${unowned}`)).toBe(false);

    // --- Read state is durable, private and per person.
    const before = await inbox(op1);
    expect(before.unread).toBe(before.items.length);
    const target = before.items[0]!;
    expect(await as(op2, () => markRead({ ids: [target.id] }, { orm }))).toBe(0); // Another member cannot mark it.
    expect((await inbox(op1)).items[0]!.readAt).toBeNull();
    expect(await as(op1, () => markRead({ ids: [target.id] }, { orm }))).toBe(1);
    expect(await as(op1, () => markRead({ ids: [target.id] }, { orm }))).toBe(0);
    expect((await inbox(op1)).items[0]!.readAt).not.toBeNull();
    expect((await inbox(op1)).unread).toBe(before.unread - 1);
    expect((await inbox(op1, { unreadOnly: true })).items.every((item) => item.readAt === null)).toBe(true);
    expect(await as(outsider, () => markRead({ ids: before.items.map((item) => item.id) }, { orm }))).toBe(0);
    const allPaged: string[] = []; let cursor: string | undefined;
    do { const page = await inbox(op1, { limit: 4, cursor }); allPaged.push(...page.items.map((item) => item.id)); cursor = page.next ?? undefined; } while (cursor);
    expect(allPaged).toEqual((await inbox(op1, { limit: 100 })).items.map((item) => item.id));
    await expect(inbox(op1, { cursor: "garbage" })).rejects.toMatchObject({ status: 400 });
    expect(await as(op2, () => markRead({ all: true }, { orm }))).toBeGreaterThan(0);
    expect((await inbox(op2)).unread).toBe(0);
    expect((await inbox(op1)).unread).toBeGreaterThan(0); // Marking all is also personal.

    // --- Losing access withdraws what a notification said.
    const op1Visible = (await inbox(op1)).items.length;
    await orm.em.fork().nativeUpdate(AccessGrantEntity, { subjectId: op1.membershipId }, { enabled: false });
    const after = await inbox(op1);
    expect(after.items.length).toBeLessThan(op1Visible);
    expect(after.items.every((item) => item.taskId === null)).toBe(true);
    expect(after.unread).toBe(0);
    await orm.em.fork().nativeUpdate(AccessGrantEntity, { subjectId: op1.membershipId }, { enabled: true });
    expect((await inbox(op1)).items.length).toBe(op1Visible);

    // --- Exactly once: reprocessing the same event creates nothing new.
    const total = await orm.em.fork().count(NotificationEntity, {});
    await orm.em.fork().nativeUpdate(OutboxMessageEntity, { topic: NOTIFICATION_TOPIC }, { status: "pending", availableAt: new Date(0), attempts: 0 });
    await drain();
    expect(await orm.em.fork().count(NotificationEntity, {})).toBe(total);
    expect((await sql("select count(*)::int as c from (select notification_id, membership_id from notification_recipients group by 1, 2 having count(*) > 1) d"))[0].c).toBe(0);

    // --- A failing event retries with backoff and finally stops, without blocking later events.
    const poison = await orm.em.fork().transactional((tx) => enqueueNotificationEvent(createPersistenceRepositories(tx).outbox, org.id,
      { kind: "task.assigned", taskId: t1, toMembershipId: "not-a-uuid" }, new Date()));
    await drain();
    let row = await orm.em.fork().findOneOrFail(OutboxMessageEntity, { id: poison.id }, { refresh: true });
    expect(row).toMatchObject({ status: "pending", attempts: 1, lastError: "Notification fan-out failed; retry scheduled." });
    expect(row.availableAt.getTime()).toBeGreaterThan(Date.now() - 1000);
    for (let attempt = 1; attempt < MAX_FANOUT_ATTEMPTS; attempt++) {
      await orm.em.fork().nativeUpdate(OutboxMessageEntity, { id: poison.id }, { availableAt: new Date(0) });
      await drain();
    }
    row = await orm.em.fork().findOneOrFail(OutboxMessageEntity, { id: poison.id }, { refresh: true });
    expect(row).toMatchObject({ status: "failed", lastError: "Notification could not be created after several attempts." });
    const unrelated = await task();
    await as(op1, () => workflow.claim(op1, unrelated)); await as(op1, () => workflow.assign(op1, unrelated, op2.membershipId)); await drain();
    expect((await inbox(op2)).items[0]).toMatchObject({ link: `/tasks/${unrelated}` });

    // --- The external channel: signed, deduplicable, retried, redacted, and only for its organization.
    const webhookRows = await orm.em.fork().find(OutboxMessageEntity, { topic: WEBHOOK_TOPIC });
    expect(webhookRows.length).toBeGreaterThan(5);
    expect(webhookRows.length).toBe(await orm.em.fork().count(NotificationEntity, { createdAt: { $gte: new Date(0) } })); // One delivery per notification.
    received.length = 0; status = 500;
    expect(await delivery.runOne()).toBe(true);
    const failedOnce = await orm.em.fork().findOneOrFail(OutboxMessageEntity, { id: { $in: webhookRows.map((candidate) => candidate.id) }, attempts: 1, status: "pending" }, { refresh: true });
    expect(failedOnce.lastError).toBe("Delivery failed; retry scheduled."); // No URL, status text or secret.
    expect(JSON.stringify(failedOnce)).not.toContain(SECRET);
    expect(JSON.stringify(failedOnce)).not.toContain("127.0.0.1");
    expect(failedOnce.availableAt.getTime()).toBeGreaterThan(Date.now());
    status = 200; received.length = 0;
    await orm.em.fork().nativeUpdate(OutboxMessageEntity, { topic: WEBHOOK_TOPIC }, { availableAt: new Date(0) });
    let sent = 0; while (await delivery.runOne()) sent += 1;
    expect(sent).toBeGreaterThanOrEqual(webhookRows.length);
    const one = received[0]!;
    const body = JSON.parse(one.body) as { id: string; kind: string; text: string; link: string; recipients: string[]; title: string; organization: string };
    expect(one.headers["x-agent-taskbay-delivery"]).toBe(body.id);
    expect(one.headers["x-agent-taskbay-signature"]).toBe(`v1=${createHmac("sha256", SECRET).update(`${one.headers["x-agent-taskbay-timestamp"]}.${one.body}`).digest("hex")}`);
    expect(Math.abs(Number(one.headers["x-agent-taskbay-timestamp"]) - Date.now() / 1000)).toBeLessThan(120);
    expect(body).toMatchObject({ organization: "local", link: expect.stringMatching(/^https:\/\/console\.example\.test\//) });
    expect(body.text).toContain(body.title);
    expect(body.recipients.every((name) => ["admin", "op1", "op2"].includes(name))).toBe(true);
    for (const message of received) {
      for (const secretText of ["SECRET-PROPOSAL-TEXT", "Too broad", "Add rollback", SECRET]) expect(message.body).not.toContain(secretText);
      expect(message.headers.authorization).toBeUndefined();
      expect(message.headers.cookie).toBeUndefined();
    }
    expect(new Set(received.map((message) => message.headers["x-agent-taskbay-delivery"])).size).toBe(received.length); // One post per notification when healthy.
    // Persistent failure ends in `failed` after bounded attempts, without touching the inbox.
    status = 503;
    await orm.em.fork().transactional((tx) => enqueueNotificationEvent(createPersistenceRepositories(tx).outbox, org.id, { kind: "test", toMembershipId: admin.membershipId }, new Date())); await drain();
    for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS + 2; attempt++) {
      await orm.em.fork().nativeUpdate(OutboxMessageEntity, { topic: WEBHOOK_TOPIC, status: "pending" }, { availableAt: new Date(0) });
      await delivery.runOne();
    }
    const stuck = await orm.em.fork().find(OutboxMessageEntity, { topic: WEBHOOK_TOPIC, status: "failed" });
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.lastError).toBe("Delivery failed after repeated attempts.");
    expect((await inbox(admin)).items[0]).toMatchObject({ kind: "test" });
    // Status for administrators, and a test notification through the whole pipeline.
    expect(await as(op1, () => channelStatus({ orm })).catch((error) => error.status)).toBe(403);
    const reported = await as(admin, () => channelStatus({ orm }));
    expect(reported).toMatchObject({ configured: false, host: null }); // The runtime channel comes from the environment, not this test's.
    expect(reported.counts.failed).toBe(1);
    expect(reported.lastFailure?.message).toBe("Delivery failed after repeated attempts.");
    await as(admin, () => sendTestNotification({ orm })); await drain();
    expect((await inbox(admin)).items[0]).toMatchObject({ title: "Test notification", link: "/notifications" });
    await expect(as(viewer, () => sendTestNotification({ orm }))).rejects.toMatchObject({ status: 403 });
    // Another organization never uses this organization's channel.
    expect(channel.enabledFor(foreign.id, "foreign")).toBe(false);

    // --- Configuration is validated before anything is sent.
    expect(loadNotifyConfig({})).toEqual({});
    expect(() => loadNotifyConfig({ A2A_NOTIFY_WEBHOOK_URL: url, A2A_NOTIFY_WEBHOOK_SECRET: "short" })).toThrow(/at least 32/);
    expect(() => loadNotifyConfig({ A2A_NOTIFY_WEBHOOK_URL: "ftp://example.test/x", A2A_NOTIFY_WEBHOOK_SECRET: SECRET })).toThrow();
    expect(() => loadNotifyConfig({ A2A_NOTIFY_WEBHOOK_URL: `${url}?token=x`, A2A_NOTIFY_WEBHOOK_SECRET: SECRET })).toThrow();
    expect(loadNotifyConfig({ A2A_NOTIFY_WEBHOOK_URL: url, A2A_NOTIFY_WEBHOOK_SECRET: SECRET }).webhook).toMatchObject({ organizationSlug: "local" });

    // --- Records are tamper-resistant; only the read mark moves.
    const notification = (await orm.em.fork().find(NotificationEntity, {}, { limit: 1 }))[0]!;
    await expect(sql("update notifications set title = 'forged' where id = ?", [notification.id])).rejects.toThrow(/immutable/);
    await expect(sql("delete from notifications where id = ?", [notification.id])).rejects.toThrow(/immutable/);
    const recipient = (await orm.em.fork().find(NotificationRecipientEntity, { notificationId: notification.id }, { limit: 1 }))[0]!;
    await expect(sql("update notification_recipients set membership_id = ? where id = ?", [op2.membershipId, recipient.id])).rejects.toThrow(/immutable/);
    await expect(sql("delete from notification_recipients where id = ?", [recipient.id])).rejects.toThrow(/immutable/);
    await sql("update notification_recipients set read_at = now() where id = ?", [recipient.id]);
    await orm.em.fork().nativeUpdate(TaskEntity, { id: t1 }, { state: "TASK_STATE_COMPLETED" });

    // --- Durable across restart; rollback and reapply restore the schema.
    const kept = (await inbox(op1)).items.length;
    await orm.close(true); orm = await createDatabaseOrm(config);
    expect((await as(op1, () => listInbox({ unreadOnly: false, limit: 100 }, { orm }))).items.length).toBe(kept);
    await orm.migrator.down(); await orm.migrator.up();
    expect(await orm.migrator.checkSchema()).toBe(false);
  } finally { await new Promise<void>((resolve) => receiver.close(() => resolve())); await orm.close(true); }
}

async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-notifications-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("NTF-001/002 PGlite notifications", () => {
  it("verifies durable per-person notifications, read state, fan-out rules and the signed webhook channel", async () => {
    await temporary((directory) => contract({ profile: "pglite", dataDir: join(directory, "db") }, directory));
  });
});
const postgresUrl = process.env.A2A_TEST_POSTGRES_URL;
if (process.env.CI === "true" && !postgresUrl) throw new Error("CI must set A2A_TEST_POSTGRES_URL");
if (postgresUrl && !decodeURIComponent(new URL(postgresUrl).pathname).includes("test")) throw new Error("A2A_TEST_POSTGRES_URL must target a test database");
(postgresUrl ? describe : describe.skip)("TST-001 PostgreSQL notifications", () => {
  it("passes the same notification contract", async () => {
    await temporary((directory) => contract({ profile: "postgresql", url: postgresUrl! }, directory));
  });
});
