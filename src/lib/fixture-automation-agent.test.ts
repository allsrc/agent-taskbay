import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CancelTaskRequest, GetTaskRequest, ListTasksRequest, SendMessageRequest } from "@a2a-js/sdk";
import { ClientFactory, JsonRpcTransportFactory, type Client } from "@a2a-js/sdk/client";
import { startFormAgent } from "../../scripts/fixture-form-agent.mjs";

// The `automation` variant of the sample agent that `npx agent-taskbay demo-agent` serves: tasks another system started.
let agent: Awaited<ReturnType<typeof startFormAgent>>;
let client: Client;
beforeAll(async () => {
  agent = await startFormAgent();
  client = await new ClientFactory({ transports: [new JsonRpcTransportFactory()] }).createFromUrl(agent.cardUrl("automation"));
});
afterAll(async () => { await agent.close(); });

const list = async (filter: Record<string, unknown> = {}) => (await client.listTasks(ListTasksRequest.fromJSON({ tenant: "", pageSize: 25, ...filter }))).tasks;
const reply = (text: string, taskId: string) => SendMessageRequest.fromJSON({ tenant: "", message: { messageId: crypto.randomUUID(), role: "ROLE_USER", taskId, contextId: "pipeline-run-41", parts: [{ text }] },
  configuration: { returnImmediately: true } });

describe("the automation sample agent", () => {
  it("starts with a task waiting for a person and a finished one, as if a pipeline started them", async () => {
    const tasks = await list();
    expect(tasks.map((task) => task.id).sort()).toEqual(["nightly-report", "rotate-staging-credentials"]);
    expect(await list({ status: "TASK_STATE_INPUT_REQUIRED" })).toHaveLength(1);
    expect(await list({ contextId: "pipeline-run-40" })).toHaveLength(1);
  });

  it("reads one task and refuses an unknown one", async () => {
    expect((await client.getTask(GetTaskRequest.fromJSON({ tenant: "", id: "rotate-staging-credentials" }))).id).toBe("rotate-staging-credentials");
    await expect(client.getTask(GetTaskRequest.fromJSON({ tenant: "", id: "nope" }))).rejects.toMatchObject({ name: "TaskNotFoundError" });
  });

  it("refuses to cancel or continue a finished task", async () => {
    await expect(client.cancelTask(CancelTaskRequest.fromJSON({ tenant: "", id: "nightly-report" }))).rejects.toMatchObject({ name: "TaskNotCancelableError" });
    await expect(client.sendMessage(reply("again", "nightly-report"))).rejects.toMatchObject({ name: "UnsupportedOperationError" });
  });

  it("completes the waiting task when a person answers it", async () => {
    await client.sendMessage(reply("staging", "rotate-staging-credentials"));
    const task = await client.getTask(GetTaskRequest.fromJSON({ tenant: "", id: "rotate-staging-credentials" }));
    expect(JSON.stringify(task)).toContain("Rotated staging");
    expect((await list({ status: "TASK_STATE_COMPLETED" })).map((entry) => entry.id).sort()).toEqual(["nightly-report", "rotate-staging-credentials"]);
  });
});
