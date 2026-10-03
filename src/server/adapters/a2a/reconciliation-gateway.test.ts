import { describe, expect, it, vi } from "vitest";
import { SdkReconciliationGateway } from "./reconciliation-gateway";
import { ListTasksUnsupported } from "../../application/ports/reconciliation";
import type { AgentRecord, SyncCursorRecord, TaskRecord } from "../../domain/persistence-model";
const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/gateway", () => ({ executeOperation: execute }));
vi.mock("./agent-connection", () => ({ agentConnection: vi.fn(async (agent: AgentRecord) => ({ cardUrl: agent.cardUrl, auth: { type: "none" }, headers: {} })) }));
const agent = { cardUrl: "https://example.test/card" } as AgentRecord;
const cursor = { tenant: "tenant-a", pageToken: "page-2" } as SyncCursorRecord;
const task = { tenant: "tenant-a", remoteTaskId: "remote" } as TaskRecord;
describe("INT-001 REL-002 reconciliation gateway", () => {
  it("uses scoped SDK reads, requests artifacts and preserves pagination", async () => {
    const signal = new AbortController().signal;
    execute.mockResolvedValueOnce({ result: { id: "remote" } });
    expect(await new SdkReconciliationGateway().get(agent, task, signal)).toEqual({ task: { id: "remote" } });
    expect(execute.mock.lastCall![0]).toMatchObject({ action: "getTask", params: { taskId: "remote", tenant: "tenant-a" }, signal });
    execute.mockResolvedValueOnce({ result: { tasks: [{ id: "remote" }], nextPageToken: "next" } });
    expect(await new SdkReconciliationGateway().list(agent, cursor, signal)).toEqual({ tasks: [{ task: { id: "remote" } }], nextPageToken: "next" });
    expect(execute.mock.lastCall![0]).toMatchObject({ action: "listTasks", params: { tenant: "tenant-a", pageToken: "page-2", pageSize: 100, includeArtifacts: true } });
    expect(execute.mock.lastCall![0].params.historyLength).toBeUndefined();
  });
  it("recognizes explicit v0.3 and unsupported SDK envelopes without swallowing transient errors", async () => {
    for (const error of [Object.assign(new Error("v0.3"), { name: "JsonRpcTransportError", envelopeCode: -32601 }),
      Object.assign(new Error("v0.3"), { name: "UnsupportedOperationError" }),
      Object.assign(new Error("not implemented"), { name: "JsonRpcUnsupportedOperationError" })]) {
      execute.mockRejectedValueOnce(error);
      await expect(new SdkReconciliationGateway().list(agent, cursor, new AbortController().signal)).rejects.toBeInstanceOf(ListTasksUnsupported);
    }
    execute.mockRejectedValueOnce(new Error("network unavailable"));
    await expect(new SdkReconciliationGateway().list(agent, cursor, new AbortController().signal)).rejects.toThrow("network unavailable");
  });
});
