import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabaseOrm } from "./orm";
import type { DatabaseConfig } from "./config";
import { createPersistenceRepositories } from "./repositories";
import { DatabaseAgentRegistry } from "./agent-registry";
import { provisionIdentity } from "./identity-repository";
import { createGrant } from "./security-repository";
import { OutboxMessageEntity } from "./entities";
import { withPrincipal } from "../auth/principal-context";
import { createTaskObserver } from "../../runtime/task-persistence";
import { readInbox } from "../../runtime/inbox";
import { createWorkflowService, readWorkflow } from "../../runtime/workflow";
import { createNotificationFanout, listInbox } from "../../runtime/notifications";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { NOTIFICATION_TOPIC } from "../../application/ports/notifications";
import { DISCOVERED_NOTIFY_WINDOW_MS } from "../../application/services/observe-task";
import type { JsonValue } from "../../domain/persistence-model";

// What a person is told about tasks that were started outside Taskbay, and where they appear.
async function contract(config: DatabaseConfig, directory: string) {
  const orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    const registry = new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => [] });
    const agent = await registry.add("https://agent.test/card");
    const org = (await createPersistenceRepositories(orm.em.fork()).organizations.findBySlug("local"))!;
    const person = (subject: string, role: "admin" | "operator") => provisionIdentity(orm.em.fork(), { issuer: "https://idp.test", subject, organizationId: org.id, displayName: subject, role });
    const admin = await person("admin", "admin");
    const whole = await person("whole", "operator");
    const skillScoped = await person("skill", "operator");
    const grant = (membershipId: string, skillId: string | null) => orm.em.fork().transactional((tx) => createGrant(tx, admin, { subjectType: "membership", subjectId: membershipId, agentId: agent.id, skillId, permission: "operate" }));
    await grant(whole.membershipId, null);
    await grant(skillScoped.membershipId, "public");
    const store = new FilesystemArtifactStore(join(directory, "artifacts"));

    const task = (id: string, state: string, age: number | null) => ({ task: { id, contextId: `ctx-${id}`, status: { state: `TASK_STATE_${state}`,
      ...(age === null ? {} : { timestamp: new Date(Date.now() - age).toISOString() }) } } }) as JsonValue;
    const observe = (event: JsonValue, session: { origin?: "discovered"; trackedByUserId?: string | null } = {}) =>
      createTaskObserver({ organizationId: org.id, agentId: agent.id, sessionId: randomUUID(), requestId: randomUUID(), source: "reconcile", ...session },
        { orm, store, manageSubscription: false, managePush: false })(event);
    const notifications = async () => (await orm.em.fork().find(OutboxMessageEntity, { topic: NOTIFICATION_TOPIC })).map((row) => row.payloadJson as { kind: string; taskId?: string; detail?: string });
    const tracked = { origin: "discovered" as const, trackedByUserId: whole.userId };
    const automatic = { origin: "discovered" as const, trackedByUserId: null };

    // A task a person tracked is never news on first sight, whatever its state.
    for (const [id, state] of [["t-input", "INPUT_REQUIRED"], ["t-auth", "AUTH_REQUIRED"], ["t-done", "COMPLETED"]]) await observe(task(id, state, 0), tracked);
    expect(await notifications()).toEqual([]);
    // Automatic discovery tells people only about work waiting on them that the agent updated within a day.
    const waiting = await observe(task("a-input", "INPUT_REQUIRED", 60_000), automatic);
    await observe(task("a-auth", "AUTH_REQUIRED", 60_000), automatic);
    await observe(task("a-old", "INPUT_REQUIRED", DISCOVERED_NOTIFY_WINDOW_MS + 60_000), automatic);
    await observe(task("a-untimed", "INPUT_REQUIRED", null), automatic);
    for (const [id, state] of [["a-done", "COMPLETED"], ["a-failed", "FAILED"], ["a-working", "WORKING"]]) await observe(task(id, state, 0), automatic);
    expect((await notifications()).map(({ kind, detail }) => `${kind}:${detail}`).sort()).toEqual(["task.needs_input:auth", "task.needs_input:input"]);
    // Seeing the same snapshot again adds nothing.
    await observe(task("a-input", "INPUT_REQUIRED", 60_000));
    expect(await notifications()).toHaveLength(2);
    // A later change to a tracked task notifies like any task.
    await observe(task("later", "WORKING", 0), tracked);
    expect(await notifications()).toHaveLength(2);
    await observe(task("later", "INPUT_REQUIRED", 0));
    expect(await notifications()).toHaveLength(3);
    // A task started from Taskbay behaves as before: its first needs-input state notifies.
    await observe(task("created", "INPUT_REQUIRED", 0));
    expect(await notifications()).toHaveLength(4);

    // The people told are those who can operate the agent, and the wording says where the task came from.
    const fanout = createNotificationFanout({ orm })!;
    for (let ran = 0; await fanout.runOne() && ran < 40; ran++);
    const asWhole = await withPrincipal(whole, () => listInbox({ unreadOnly: false, limit: 50 }, { orm }));
    const titles = asWhole.items.map((item) => item.title);
    expect(titles).toContain("A task started outside Taskbay needs input");
    expect(titles).toContain("A task started outside Taskbay needs authorization");
    expect(titles).toContain("Input needed");
    // Skill-scoped people are told about nothing they cannot open.
    expect((await withPrincipal(skillScoped, () => listInbox({ unreadOnly: false, limit: 50 }, { orm }))).items).toEqual([]);

    // Waiting discovered tasks appear under "needs input" for whole-agent grants and administrators, never for skill grants.
    const needing = async (who: typeof admin) => (await withPrincipal(who, () => readInbox({ view: "needs-input", limit: 100 }, { orm }))).items.map((item) => item.taskId);
    expect(await needing(whole)).toContain(waiting.localId);
    expect(await needing(admin)).toContain(waiting.localId);
    expect(await needing(skillScoped)).toEqual([]);
    // Tracking is not claiming, and ownership works on a discovered task like any other.
    expect((await withPrincipal(whole, () => readWorkflow(waiting.localId, { orm })))?.assignment?.assigneeMembershipId ?? null).toBeNull();
    await withPrincipal(whole, () => createWorkflowService({ orm }).claim(whole, waiting.localId));
    expect((await withPrincipal(whole, () => readWorkflow(waiting.localId, { orm })))?.assignment?.assigneeMembershipId).toBe(whole.membershipId);
    // Nothing is browsed into the inbox: a task that was never stored does not appear anywhere.
    expect((await needing(whole)).length).toBe((await needing(admin)).length);
  } finally { await orm.close(true); }
}
async function temporary(config: (directory: string) => DatabaseConfig) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-discovered-notify-"));
  try { await contract(config(directory), directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("notifications and inbox for discovered tasks (PGlite)", () => {
  it("follows the first-sight rules and shows waiting tasks to whole-agent grants", () => temporary((dir) => ({ profile: "pglite", dataDir: join(dir, "db") })));
});
const url = process.env.A2A_TEST_POSTGRES_URL;
if (url && !decodeURIComponent(new URL(url).pathname).includes("test")) throw new Error("Use a test database");
(url ? describe : describe.skip)("notifications and inbox for discovered tasks (PostgreSQL)", () => {
  it("passes the same contract", () => temporary(() => ({ profile: "postgresql", url: url! })));
});
