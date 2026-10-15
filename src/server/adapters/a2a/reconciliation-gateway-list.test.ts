import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SdkReconciliationGateway } from "./reconciliation-gateway";
import { ListTasksUnsupported } from "../../application/ports/reconciliation";
import type { AgentRecord, SyncCursorRecord } from "../../domain/persistence-model";
import { startScenarioAgent } from "../../../../scripts/fixture-scenario-agent.mjs";

vi.mock("./agent-connection", () => ({ agentConnection: async () => ({ cardUrl: agent.cardUrl, auth: { type: "none" }, headers: {} }) }));
let agent: Awaited<ReturnType<typeof startScenarioAgent>>;
beforeAll(async () => { agent = await startScenarioAgent(); });
afterAll(async () => { await agent.close(); });
beforeEach(async () => { await agent.control({ reset: true }); });

const record = { id: "a", organizationId: "o", cardUrl: "" } as unknown as AgentRecord;
const cursor = (pageToken = "") => ({ tenant: "", pageToken } as unknown as SyncCursorRecord);
const gateway = new SdkReconciliationGateway();
const signal = new AbortController().signal;

describe("SdkReconciliationGateway.list", () => {
  it("reads the last page, which the SDK serializes without a next-page token", async () => {
    await agent.control({ seed: [{ id: "a", state: "working" }, { id: "b", state: "working" }] });
    const page = await gateway.list(record, cursor(), signal);
    expect(page.tasks).toHaveLength(2);
    expect(page.nextPageToken).toBe("");
  });
  it("reads an empty list, which the SDK serializes without a task array", async () => {
    expect(await gateway.list(record, cursor(), signal)).toEqual({ tasks: [], nextPageToken: "" });
  });
  it("still follows a token while there are more pages, and passes discovery's options", async () => {
    await agent.control({ seed: Array.from({ length: 101 }, (_, index) => ({ id: `t${index}`, state: "working" })) });
    const first = await gateway.list(record, cursor(), signal, { statusTimestampAfter: new Date("2026-01-01T00:00:00Z"), historyLength: 20 });
    expect(first.tasks).toHaveLength(100);
    expect(first.nextPageToken).not.toBe("");
    expect((await gateway.list(record, cursor(first.nextPageToken), signal)).tasks).toHaveLength(1);
    expect((await agent.state()).log[0].params).toMatchObject({ statusTimestampAfter: "2026-01-01T00:00:00.000Z", historyLength: 20 });
  });
  it("says when the agent cannot list tasks", async () => {
    await agent.control({ noList: true });
    await expect(gateway.list(record, cursor(), signal)).rejects.toBeInstanceOf(ListTasksUnsupported);
  });
});
