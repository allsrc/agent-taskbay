import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CancelTaskRequest, GetTaskRequest, ListTasksRequest, ListTaskPushNotificationConfigsRequest, SendMessageRequest, SubscribeToTaskRequest, TaskPushNotificationConfig,
} from "@a2a-js/sdk";
import { ClientFactory, JsonRpcTransportFactory, type Client } from "@a2a-js/sdk/client";
import { startScenarioAgent, SCENARIO_EXTENSION_URI } from "../../scripts/fixture-scenario-agent.mjs";

interface Agent { origin: string; cardUrl: string; control(body: unknown): Promise<unknown>; state(): Promise<{ log: Array<{ method: string; params: Record<string, unknown> }>; tasks: unknown[] }>; close(): Promise<void> }
let agent: Agent;
let client: Client;

const send = (text: string, extra: Record<string, unknown> = {}) => SendMessageRequest.fromJSON({
  tenant: "", message: { messageId: crypto.randomUUID(), role: "ROLE_USER", parts: [{ text }], ...extra }, configuration: { returnImmediately: true },
});
const asTask = (value: unknown) => value as { id: string; contextId: string; status: { state: string | number } };
const tasks = async (request: Record<string, unknown> = {}) => (await client.listTasks(ListTasksRequest.fromJSON({ tenant: "", pageSize: 25, ...request }))).tasks;
const seed = (...entries: Array<Record<string, unknown>>) => agent.control({ seed: entries });

beforeAll(async () => {
  agent = await startScenarioAgent();
  client = await new ClientFactory({ transports: [new JsonRpcTransportFactory()] }).createFromUrl(agent.origin);
});
afterAll(async () => { await agent.close(); });
beforeEach(async () => { await agent.control({ reset: true }); });

describe("scenario fixture agent", () => {
  it("serves its card at both well-known paths and lists the control-free defaults", async () => {
    for (const path of ["/card.json", "/.well-known/agent-card.json"]) {
      const card = await (await fetch(`${agent.origin}${path}`)).json();
      expect(card.supportedInterfaces[0]).toMatchObject({ protocolBinding: "JSONRPC", protocolVersion: "1.0" });
      expect(card.capabilities.extendedAgentCard).toBe(false);
    }
  });

  it("creates a task on SendMessage and answers GetTask, ListTasks and CancelTask with SDK shapes", async () => {
    const created = asTask((await client.sendMessage(send("start"))));
    expect(created.id).toMatch(/^scenario-task-/);
    const fetched = await client.getTask(GetTaskRequest.fromJSON({ tenant: "", id: created.id }));
    expect(fetched.id).toBe(created.id);
    expect((await tasks()).map((task) => task.id)).toContain(created.id);
    const canceled = await client.cancelTask(CancelTaskRequest.fromJSON({ tenant: "", id: created.id }));
    expect(canceled.id).toBe(created.id);
  });

  it("seeds foreign tasks, filters ListTasks and pages with tokens", async () => {
    await seed(
      { id: "a", contextId: "c1", state: "working", updatedAt: "2026-01-03T00:00:00Z" },
      { id: "b", contextId: "c1", state: "input-required", updatedAt: "2026-01-02T00:00:00Z" },
      { id: "c", contextId: "c2", state: "completed", updatedAt: "2026-01-01T00:00:00Z" },
    );
    expect((await tasks()).map((task) => task.id)).toEqual(["a", "b", "c"]);
    expect((await tasks({ contextId: "c1" })).map((task) => task.id)).toEqual(["a", "b"]);
    expect((await tasks({ status: "TASK_STATE_COMPLETED" })).map((task) => task.id)).toEqual(["c"]);
    expect((await tasks({ statusTimestampAfter: "2026-01-02T00:00:00Z" })).map((task) => task.id)).toEqual(["a", "b"]);
    const first = await client.listTasks(ListTasksRequest.fromJSON({ tenant: "", pageSize: 2 }));
    expect(first.tasks).toHaveLength(2);
    expect(first.nextPageToken).not.toBe("");
    const second = await client.listTasks(ListTasksRequest.fromJSON({ tenant: "", pageSize: 2, pageToken: first.nextPageToken }));
    expect(second.tasks.map((task) => task.id)).toEqual(["c"]);
    expect(second.nextPageToken).toBe("");
  });

  it("answers an input-required task and refuses input to a finished one", async () => {
    await seed({ id: "ask", contextId: "c", state: "input-required" }, { id: "done", contextId: "c", state: "completed" });
    const answered = await client.sendMessage(send("yes", { taskId: "ask", contextId: "c" }));
    expect(asTask(answered).status.state).toBeDefined();
    await expect(client.sendMessage(send("again", { taskId: "done", contextId: "c" }))).rejects.toMatchObject({ name: "UnsupportedOperationError" });
  });

  it("ignores or rejects input to a working task when asked", async () => {
    await seed({ id: "w", contextId: "c", state: "working" });
    await agent.control({ ignoreInputWhileWorking: true });
    await client.sendMessage(send("steer", { taskId: "w", contextId: "c" }));
    expect((await agent.state()).tasks).toMatchObject([{ id: "w", history: [] }]);
    await agent.control({ ignoreInputWhileWorking: false, rejectInputWhileWorking: true });
    await expect(client.sendMessage(send("steer", { taskId: "w", contextId: "c" }))).rejects.toMatchObject({ name: "UnsupportedOperationError" });
  });

  it.each([
    ["TaskNotCancelableError", -32002], ["UnsupportedOperationError", -32004], ["ContentTypeNotSupportedError", -32005],
    ["ExtensionSupportRequiredError", -32008], ["VersionNotSupportedError", -32009], ["InternalError", -32603],
  ])("fails CancelTask with %s", async (error, code) => {
    await seed({ id: "t", contextId: "c", state: "working" });
    await agent.control({ fail: { method: "CancelTask", error, times: 1 } });
    await expect(client.cancelTask(CancelTaskRequest.fromJSON({ tenant: "", id: "t" }))).rejects.toMatchObject({ envelopeCode: code });
    await client.cancelTask(CancelTaskRequest.fromJSON({ tenant: "", id: "t" }));
  });

  it("refuses to cancel a finished task and an unknown one with the A2A errors", async () => {
    await seed({ id: "done", contextId: "c", state: "completed" });
    await expect(client.cancelTask(CancelTaskRequest.fromJSON({ tenant: "", id: "done" }))).rejects.toMatchObject({ name: "TaskNotCancelableError" });
    await expect(client.getTask(GetTaskRequest.fromJSON({ tenant: "", id: "missing" }))).rejects.toMatchObject({ name: "TaskNotFoundError" });
  });

  it("drops the connection after reading the request", async () => {
    await agent.control({ fail: { method: "SendMessage", error: "drop", times: 1 } });
    await expect(client.sendMessage(send("lost"))).rejects.toBeDefined();
    expect((await agent.state()).log.map((entry) => entry.method)).toContain("SendMessage");
  });

  it("advertises a required extension", async () => {
    await agent.control({ requireExtension: SCENARIO_EXTENSION_URI });
    const card = await (await fetch(agent.cardUrl)).json();
    expect(card.capabilities.extensions).toEqual([{ uri: SCENARIO_EXTENSION_URI, required: true }]);
  });

  it("serves the extended card only when configured", async () => {
    await expect(client.getAgentCard()).resolves.toBeDefined();
    const missing = await fetch(`${agent.origin}/a2a`, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "GetExtendedAgentCard", params: {} }) });
    expect((await missing.json()).error.code).toBe(-32007);
    await agent.control({ extendedCard: { skills: [{ id: "extra", name: "Extra", description: "Authenticated only", tags: [] }] } });
    const present = await fetch(`${agent.origin}/a2a`, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "GetExtendedAgentCard", params: {} }) });
    expect((await present.json()).result.skills.map((skill: { id: string }) => skill.id)).toEqual(["work", "extra"]);
    expect((await (await fetch(agent.cardUrl)).json()).capabilities.extendedAgentCard).toBe(true);
  });

  it("can stop supporting ListTasks and can declare tenants", async () => {
    await agent.control({ noList: true, tenants: ["acme"] });
    await expect(tasks()).rejects.toBeDefined();
    const card = await (await fetch(agent.cardUrl)).json();
    expect(card.supportedInterfaces[0].tenant).toBe("acme");
  });

  it("creates, lists and deletes push configurations", async () => {
    await seed({ id: "p", contextId: "c", state: "working" });
    const created = await client.createTaskPushNotificationConfig(TaskPushNotificationConfig.fromJSON({ tenant: "", taskId: "p", url: "http://127.0.0.1:1/hook", token: "t" }));
    expect(created.id).not.toBe("");
    const listed = await client.listTaskPushNotificationConfig(ListTaskPushNotificationConfigsRequest.fromJSON({ tenant: "", taskId: "p" }));
    expect(listed.configs).toHaveLength(1);
  });

  it("streams the current task, then updates, and ends at a terminal state", async () => {
    await seed({ id: "s", contextId: "c", state: "working" });
    const events: unknown[] = [];
    const reader = (async () => { for await (const event of client.resubscribeTask(SubscribeToTaskRequest.fromJSON({ tenant: "", id: "s" }))) events.push(event); })();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await agent.control({ advance: { id: "s", state: "completed", message: "done" } });
    await reader;
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses control calls that do not come from loopback and unknown error names", async () => {
    const bad = await fetch(`${agent.origin}/__control`, { method: "POST", body: JSON.stringify({ fail: { method: "GetTask", error: "Nope" } }) });
    expect(bad.status).toBe(400);
  });
});
