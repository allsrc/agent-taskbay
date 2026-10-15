import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabaseOrm } from "./orm";
import type { DatabaseConfig } from "./config";
import { createPersistenceRepositories } from "./repositories";
import { DatabaseAgentRegistry } from "./agent-registry";
import { createTaskObserver, withTaskQueries } from "../../runtime/task-persistence";
import { acceptCommand } from "../../runtime/commands";
import type { JsonValue } from "../../domain/persistence-model";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";

// What happened to a message sent to a task that was already working is derived at read time from the command row and the ledger.
async function contract(config: DatabaseConfig, directory: string) {
  const orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    const registry = new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => [] });
    const agent = await registry.add("https://agent.test/card");
    const store = new FilesystemArtifactStore(join(directory, "artifacts"));
    const repositories = () => createPersistenceRepositories(orm.em.fork());
    const org = (await repositories().organizations.findBySlug("local"))!;
    const plain = createTaskObserver({ organizationId: org.id, agentId: agent.id, sessionId: randomUUID(), requestId: randomUUID() }, { orm, store, manageSubscription: false, managePush: false });
    const working = { task: { id: "busy", contextId: "ctx", status: { state: "TASK_STATE_WORKING" } } };
    const first = await plain(working);
    const asking = await plain({ task: { id: "ask", contextId: "ctx", status: { state: "TASK_STATE_INPUT_REQUIRED" } } });

    let sent = 0;
    /** Accepts a send command the way the API does, settles it as the worker would, and, when it succeeded, records the agent's reply. */
    async function steer(taskId: string, status: "succeeded" | "rejected" | "pending" | "uncertain", event?: Record<string, unknown>) {
      const messageId = `m-${++sent}`;
      const command = await acceptCommand(agent.id, { text: `instruction ${sent}`, taskId, messageId }, `key-${messageId}`, { orm, store });
      if (status !== "pending") {
        await repositories().commands.update(org.id, command.id, { status, resultJson: null, lastError: null, errorKind: status === "rejected" ? "unsupported_operation" : null, updatedAt: new Date() });
      }
      if (status === "succeeded") {
        const observe = createTaskObserver({ organizationId: org.id, agentId: agent.id, sessionId: randomUUID(), requestId: randomUUID(), source: "command_response",
          userMessage: { messageId, role: "ROLE_USER", taskId, contextId: "ctx", parts: [{ text: `instruction ${sent}` }] } },
        { orm, store, manageSubscription: false, managePush: false });
        await observe((event ?? { task: { id: taskId, contextId: "ctx", status: { state: "TASK_STATE_WORKING" } } }) as JsonValue);
      }
      return { messageId, command };
    }
    const steering = async (localId: string) => (await withTaskQueries((query, organizationId) => query.detail(organizationId, localId), orm, store))?.steering;

    // Accepted, and the agent shows nothing new: delivered. (An agent that ignores input behaves like this.)
    const quiet = await steer("busy", "succeeded");
    expect(await steering(first.localId)).toEqual([{ messageId: quiet.messageId, commandId: quiet.command.id, sentAt: expect.any(String), outcome: "delivered" }]);

    // The agent refused: no message reached the task, but the person's text is still available.
    const refused = await steer("busy", "rejected");
    // Waiting and uncertain commands are reported as such, never as delivered.
    const waiting = await steer("busy", "pending");
    const uncertain = await steer("busy", "uncertain");
    const byId = new Map((await steering(first.localId))!.map((entry) => [entry.messageId, entry]));
    expect(byId.get(refused.messageId)).toMatchObject({ outcome: "refused", errorKind: "unsupported_operation", text: "instruction 2" });
    expect(byId.get(waiting.messageId)).toMatchObject({ outcome: "waiting", text: "instruction 3" });
    expect(byId.get(uncertain.messageId)).toMatchObject({ outcome: "unknown", text: "instruction 4" });
    expect(byId.get(quiet.messageId)?.outcome).toBe("delivered");

    // The agent answers: that message, and the ones before it with nothing after them, are now "responded".
    const answered = await steer("busy", "succeeded", { task: { id: "busy", contextId: "ctx", status: { state: "TASK_STATE_WORKING",
      message: { messageId: "agent-1", role: "ROLE_AGENT", parts: [{ text: "Got it" }] } } } });
    const after = new Map((await steering(first.localId))!.map((entry) => [entry.messageId, entry]));
    expect(after.get(answered.messageId)?.outcome).toBe("responded");
    expect(after.get(quiet.messageId)?.outcome).toBe("responded");
    expect(after.get(refused.messageId)?.outcome).toBe("refused");
    expect([...after.values()].map((entry) => entry.sentAt)).toEqual([...after.values()].map((entry) => entry.sentAt).sort());

    // A reply to a task that asked for input is an ordinary reply, not steering.
    await steer("ask", "rejected");
        expect(await steering(asking.localId)).toEqual([]);
    const reply = await steer("ask", "succeeded", { task: { id: "ask", contextId: "ctx", status: { state: "TASK_STATE_WORKING" } } });
    expect(reply.messageId).toBeTruthy();
    expect(await steering(asking.localId)).toEqual([]);

    // Another organization never sees these commands.
    expect(await repositories().commands.findSendsByMessageIds(randomUUID(), agent.id, "", [quiet.messageId])).toEqual([]);
    expect(await repositories().commands.listUnsettledSends(randomUUID(), agent.id, "", new Date(0), 10)).toEqual([]);
    // A list row carries no steering.
    const rows = await withTaskQueries((query, organizationId) => query.listPage(organizationId, { limit: 10 }), orm, store);
    expect(rows.tasks.every((task) => (task as { steering?: unknown }).steering === undefined)).toBe(true);
  } finally { await orm.close(true); }
}
async function temporary(config: (directory: string) => DatabaseConfig) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-steering-"));
  try { await contract(config(directory), directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("steering outcome (PGlite)", () => {
  it("derives delivered, responded, refused, waiting and unknown from commands and the ledger", () => temporary((dir) => ({ profile: "pglite", dataDir: join(dir, "db") })));
});
const url = process.env.A2A_TEST_POSTGRES_URL;
if (url && !decodeURIComponent(new URL(url).pathname).includes("test")) throw new Error("Use a test database");
(url ? describe : describe.skip)("steering outcome (PostgreSQL)", () => {
  it("passes the same contract", () => temporary(() => ({ profile: "postgresql", url: url! })));
});
