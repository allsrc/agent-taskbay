import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SdkRemoteTaskGateway } from "./remote-task-gateway";
import { ListTasksUnsupported } from "../../application/ports/reconciliation";
import { RemoteRejection } from "../../application/ports/remote-errors";
import type { AgentRecord } from "../../domain/persistence-model";
import { startScenarioAgent } from "../../../../scripts/fixture-scenario-agent.mjs";

let protectedConnection = false;
vi.mock("./agent-connection", () => ({ agentConnection: async () => ({ cardUrl: agent.cardUrl, auth: { type: "none" }, headers: {},
  ...(protectedConnection ? { credentialOrigins: [agent.origin], secretValues: ["secret-present"] } : {}) }) }));

let agent: Awaited<ReturnType<typeof startScenarioAgent>>;
beforeAll(async () => { agent = await startScenarioAgent({ behaviors: { tenants: ["acme"] } }); });
afterAll(async () => { await agent.close(); });
beforeEach(async () => { protectedConnection = false; await agent.control({ reset: true }); await agent.control({ tenants: ["acme"] }); });

const record = { id: "a", organizationId: "o", cardUrl: "" } as unknown as AgentRecord;
const gateway = new SdkRemoteTaskGateway();
const seed = (...tasks: Array<Record<string, unknown>>) => agent.control({ seed: tasks.map((task) => ({ tenant: "acme", contextId: "c", ...task })) });

describe.each([["open", false], ["protected", true]])("SdkRemoteTaskGateway over a %s connection", (_label, isProtected) => {
  beforeEach(() => { protectedConnection = isProtected; });

  it("lists a page of tasks with the tenant the card declares, and pages with the agent's token", async () => {
    await seed({ id: "a", state: "working", updatedAt: "2026-01-03T00:00:00Z" }, { id: "b", state: "input-required", updatedAt: "2026-01-02T00:00:00Z" }, { id: "c", state: "completed", updatedAt: "2026-01-01T00:00:00Z" });
    const first = await gateway.list(record, { tenant: "", pageSize: 2 });
    expect(first.tasks.map((task) => (task as { id: string }).id)).toEqual(["a", "b"]);
    const second = await gateway.list(record, { tenant: "", pageSize: 2, pageToken: first.nextPageToken });
    expect(second.tasks.map((task) => (task as { id: string }).id)).toEqual(["c"]);
    expect(second.nextPageToken).toBe("");
    const log = (await agent.state()).log.filter((entry: { method: string }) => entry.method === "ListTasks");
    expect(log[0].params).toMatchObject({ tenant: "acme", pageSize: 2, historyLength: 1, includeArtifacts: false });
  });

  it("filters by state and context", async () => {
    await seed({ id: "a", state: "working", contextId: "c1" }, { id: "b", state: "completed", contextId: "c2" });
    expect((await gateway.list(record, { tenant: "", pageSize: 10, status: "TASK_STATE_COMPLETED" })).tasks).toHaveLength(1);
    expect((await gateway.list(record, { tenant: "", pageSize: 10, contextId: "c1" })).tasks).toHaveLength(1);
  });

  it("reads one task as the event the observer stores", async () => {
    await seed({ id: "one", state: "input-required" });
    expect(await gateway.get(record, "", "one")).toMatchObject({ task: { id: "one" } });
  });

  it("reports a task the agent does not know as a refusal", async () => {
    const failure = await gateway.get(record, "", "missing").catch((caught) => caught);
    expect(failure).toBeInstanceOf(RemoteRejection);
    expect(failure.kind).toBe("task_not_found");
  });

  it("says when the agent cannot list tasks, and passes other refusals on", async () => {
    await agent.control({ noList: true });
    await expect(gateway.list(record, { tenant: "", pageSize: 5 })).rejects.toBeInstanceOf(ListTasksUnsupported);
    await agent.control({ reset: true });
    await agent.control({ fail: { method: "ListTasks", error: "ExtensionSupportRequiredError", times: 1 } });
    expect(await gateway.list(record, { tenant: "", pageSize: 5 }).catch((caught) => caught)).toMatchObject({ kind: "extension_required" });
  });

  it("does not turn an unclassifiable failure into a refusal", async () => {
    await agent.control({ fail: { method: "GetTask", error: "InternalError" } });
    const failure = await gateway.get(record, "", "x").catch((caught) => caught);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(RemoteRejection);
  });
});
