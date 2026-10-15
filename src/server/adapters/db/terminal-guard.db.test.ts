import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabaseOrm } from "./orm";
import type { DatabaseConfig } from "./config";
import { createPersistenceRepositories } from "./repositories";
import { DatabaseAgentRegistry } from "./agent-registry";
import { createTaskObserver } from "../../runtime/task-persistence";
import { acceptCommand } from "../../runtime/commands";
import { FilesystemArtifactStore } from "../blob/filesystem-artifact-store";
import { TaskCommandEntity } from "./entities";

// A2A terminal states are final: a finished task is never continued or canceled, and the caller is told to start a new task.
async function contract(config: DatabaseConfig, directory: string) {
  const orm = await createDatabaseOrm(config);
  try {
    if ((await orm.migrator.getExecuted()).length) await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    const registry = new DatabaseAgentRegistry({ orm, legacyFilePath: join(directory, "absent"), environmentUrls: () => [] });
    const agent = await registry.add("https://agent.test/card");
    const org = (await createPersistenceRepositories(orm.em.fork()).organizations.findBySlug("local"))!;
    const store = new FilesystemArtifactStore(join(directory, "artifacts"));
    const observe = createTaskObserver({ organizationId: org.id, agentId: agent.id, sessionId: randomUUID(), requestId: randomUUID() },
      { orm, store, manageSubscription: false, managePush: false });
    const states = { done: "COMPLETED", broke: "FAILED", stopped: "CANCELED", refused: "REJECTED", busy: "WORKING", ask: "INPUT_REQUIRED" };
    for (const [id, state] of Object.entries(states)) await observe({ task: { id, contextId: `ctx-${id}`, status: { state: `TASK_STATE_${state}` } } });
    const commands = () => orm.em.fork().count(TaskCommandEntity, {});
    let key = 0;
    const send = (body: Record<string, unknown>) => acceptCommand(agent.id, body, `key-${key++}`, { orm, store });

    for (const id of ["done", "broke", "stopped", "refused"]) {
      for (const body of [{ text: "more", taskId: id }, { action: "cancelTask", taskId: id }]) {
        const before = await commands();
        await expect(send(body), `${id} ${body.action ?? "send"}`).rejects.toMatchObject({ status: 409, kind: "task_terminal",
          message: "This task is finished. Start a new task in the same conversation." });
        expect(await commands()).toBe(before);
      }
    }
    // Open tasks are unaffected.
    await expect(send({ text: "steer", taskId: "busy" })).resolves.toMatchObject({ action: "send" });
    await expect(send({ text: "answer", taskId: "ask" })).resolves.toMatchObject({ action: "send" });
    await expect(send({ action: "cancelTask", taskId: "busy" })).resolves.toMatchObject({ action: "cancelTask" });
    // A new task in the same context of a finished one is the supported way to continue.
    await expect(send({ text: "next step", contextId: "ctx-done" })).resolves.toMatchObject({ action: "send" });
    // An unknown task is still "not found", not "finished".
    await expect(send({ text: "?", taskId: "missing" })).rejects.toMatchObject({ status: 404 });
  } finally { await orm.close(true); }
}
async function temporary(config: (directory: string) => DatabaseConfig) {
  const directory = await mkdtemp(join(tmpdir(), "a2a-terminal-"));
  try { await contract(config(directory), directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
describe("terminal task guard (PGlite)", () => {
  it("refuses sends and cancels to finished tasks and accepts the rest", () => temporary((dir) => ({ profile: "pglite", dataDir: join(dir, "db") })));
});
const url = process.env.A2A_TEST_POSTGRES_URL;
if (url && !decodeURIComponent(new URL(url).pathname).includes("test")) throw new Error("Use a test database");
(url ? describe : describe.skip)("terminal task guard (PostgreSQL)", () => {
  it("passes the same contract", () => temporary(() => ({ profile: "postgresql", url: url! })));
});
