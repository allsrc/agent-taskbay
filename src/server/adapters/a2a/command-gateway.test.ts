import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SdkCommandGateway } from "./command-gateway";
import { RemoteRejection } from "../../application/ports/remote-errors";
import { SafeDispatchRetry } from "../../application/ports/command-dispatch";
import type { AgentRecord, TaskCommandRecord } from "../../domain/persistence-model";
import { startScenarioAgent } from "../../../../scripts/fixture-scenario-agent.mjs";

let connectionFor: () => unknown;
vi.mock("./agent-connection", () => ({ agentConnection: async () => connectionFor() }));

let agent: Awaited<ReturnType<typeof startScenarioAgent>>;
beforeAll(async () => { agent = await startScenarioAgent(); });
afterAll(async () => { await agent.close(); });
beforeEach(async () => { await agent.control({ reset: true }); });

const record = { id: "agent", organizationId: "org", cardUrl: "" } as unknown as AgentRecord;
const command = { id: "command", action: "send" } as unknown as TaskCommandRecord;
const open = () => ({ cardUrl: agent.cardUrl, auth: { type: "none" }, headers: {} });
// Any secret value makes the connection "protected": errors are replaced by a generic one that keeps only machine-readable identity.
const protectedConnection = () => ({ ...open(), credentialOrigins: [agent.origin], secretValues: ["not-in-the-card-but-present"] });
const dispatch = (action: "send" | "cancelTask" = "send", extra: Record<string, unknown> = {}) =>
  new SdkCommandGateway().dispatch(record, { ...command, action }, { text: "hello", tenant: "", ...extra });

describe.each([["open", open], ["protected", protectedConnection]] as const)("SdkCommandGateway over a %s connection", (_label, make) => {
  beforeEach(() => { connectionFor = make; });

  it.each([
    ["UnsupportedOperationError", "unsupported_operation"], ["ContentTypeNotSupportedError", "content_type_not_supported"],
    ["ExtensionSupportRequiredError", "extension_required"], ["VersionNotSupportedError", "version_not_supported"], ["RequestMalformedError", "invalid_request"],
  ])("turns %s on send into a rejection (%s)", async (error, kind) => {
    await agent.control({ fail: { method: "SendMessage", error } });
    const failure = await dispatch().catch((caught) => caught);
    expect(failure).toBeInstanceOf(RemoteRejection);
    expect(failure.kind).toBe(kind);
    // The agent's wording never reaches our message.
    expect(failure.message).toBe(`Agent rejected the request: ${kind}.`);
  });

  it("turns a refused cancel into task_not_cancelable and an unknown task into task_not_found", async () => {
    await agent.control({ seed: [{ id: "done", state: "completed", contextId: "c" }] });
    expect(await dispatch("cancelTask", { taskId: "done" }).catch((caught) => caught)).toMatchObject({ kind: "task_not_cancelable" });
    expect(await dispatch("cancelTask", { taskId: "missing" }).catch((caught) => caught)).toMatchObject({ kind: "task_not_found" });
  });

  it("leaves outcomes it cannot classify as ordinary errors, so the command stays uncertain", async () => {
    for (const error of ["InternalError", "InvalidAgentResponseError", "drop"]) {
      await agent.control({ reset: true });
      await agent.control({ fail: { method: "SendMessage", error } });
      const failure = await dispatch().catch((caught) => caught);
      expect(failure, error).toBeInstanceOf(Error);
      expect(failure, error).not.toBeInstanceOf(RemoteRejection);
      expect(failure, error).not.toBeInstanceOf(SafeDispatchRetry);
    }
  });

  it("returns the task when the agent accepts", async () => {
    expect(await dispatch()).toMatchObject({ task: { status: { state: expect.anything() } } });
  });

  it("reports the SDK's effective tenant for a first send", async () => {
    await agent.control({ tenants: ["acme"] });
    expect(await dispatch()).toMatchObject({ tenant: "acme", task: { status: { state: "TASK_STATE_WORKING" } } });
  });
});

it("treats a failure before the request leaves as a safe retry, not a rejection", async () => {
  connectionFor = () => ({ cardUrl: "http://127.0.0.1:1/card.json", auth: { type: "none" }, headers: {} });
  expect(await dispatch().catch((caught) => caught)).toBeInstanceOf(SafeDispatchRetry);
});

it("does not leak the agent's text through a protected connection", async () => {
  connectionFor = protectedConnection;
  await agent.control({ fail: { method: "SendMessage", error: "InternalError" } });
  const failure = await dispatch().catch((caught) => caught);
  expect(String(failure.message)).toBe("Protected agent operation failed.");
});
