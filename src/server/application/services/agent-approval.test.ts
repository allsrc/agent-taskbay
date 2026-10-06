import { describe, expect, it } from "vitest";
import type { DurableTaskView, ThreadMessage } from "../../../shared/task-types";
import { AGENT_REQUEST_LIFETIME, APPROVAL_REQUEST_MEDIA_TYPE, findAgentApprovalRequest, parseAgentApprovalRequest } from "./agent-approval";

const valid = { title: "Delete staging", summary: "Agent finished the migration", risk: "high", expiresInSeconds: 3600, action: { kind: "send_message", text: "Yes, delete staging" } };

describe("agent approval request parsing", () => {
  it("accepts a text or structured action and bounds the proposed lifetime", () => {
    expect(parseAgentApprovalRequest(valid)).toMatchObject({ title: "Delete staging", risk: "high", lifetimeMs: 3_600_000, action: { kind: "send_message" } });
    const structured = parseAgentApprovalRequest({ title: "Deploy", action: { kind: "send_data", form: { schema: {} }, values: { a: 1 } } })!;
    expect(structured).toMatchObject({ summary: "", risk: "medium", lifetimeMs: AGENT_REQUEST_LIFETIME.defaultMs, action: { kind: "send_data" } });
    expect(parseAgentApprovalRequest({ ...valid, expiresInSeconds: 1 })!.lifetimeMs).toBe(AGENT_REQUEST_LIFETIME.minMs);
    expect(parseAgentApprovalRequest({ ...valid, expiresInSeconds: 99_999_999 })!.lifetimeMs).toBe(AGENT_REQUEST_LIFETIME.maxMs);
  });
  it("ignores anything malformed, oversized or carrying authority fields it does not read", () => {
    for (const bad of [null, [], "x", {}, { ...valid, title: "" }, { ...valid, title: "x".repeat(301) }, { ...valid, summary: 5 }, { ...valid, risk: "extreme" },
      { ...valid, expiresInSeconds: "soon" }, { ...valid, expiresInSeconds: Infinity }, { ...valid, action: null }, { ...valid, action: { kind: "run_shell", text: "rm -rf" } },
      { ...valid, action: { kind: "send_message", text: 5 } }, { ...valid, action: { kind: "send_data", form: "x", values: {} } },
      { ...valid, summary: "x".repeat(200_000) }]) expect(parseAgentApprovalRequest(bad)).toBeUndefined();
    // Scope and authority are never read from the part.
    const parsed = parseAgentApprovalRequest({ ...valid, taskId: "other", agentId: "other", assignedMembershipId: "me", requesterUserId: "u", status: "approved", policy: { separationOfDuties: false } })!;
    expect(Object.keys(parsed).sort()).toEqual(["action", "lifetimeMs", "risk", "summary", "title"]);
  });
});

const message = (id: string, parts: ThreadMessage["parts"], fromStatus: boolean): ThreadMessage => ({ id, role: "agent", parts, timestamp: "", fromStatus });
const part = (value: unknown, mediaType = APPROVAL_REQUEST_MEDIA_TYPE) => ({ id: "p", kind: "data" as const, value, mediaType });
const view = (state: string, messages: ThreadMessage[], kind: "task" | "message" = "task"): DurableTaskView =>
  ({ localId: "t", taskId: "r", tenant: "", agentId: "a", agentName: "A", kind, state, createdAt: "", updatedAt: "", messages, artifacts: [], referenceLinks: {} });

describe("finding an agent approval request in a task", () => {
  it("reads only the latest input request of a task that is waiting", () => {
    const asking = view("TASK_STATE_INPUT_REQUIRED", [message("m1", [part(valid)], true)]);
    expect(findAgentApprovalRequest(asking)).toMatchObject({ messageId: "m1", request: { title: "Delete staging" } });
    expect(findAgentApprovalRequest(view("TASK_STATE_INPUT_REQUIRED", [message("m1", [part(valid)], true), message("m2", [{ id: "t", kind: "text", value: "Anything else?", mediaType: "text/plain" }], true)]))).toBeUndefined();
    expect(findAgentApprovalRequest(view("TASK_STATE_WORKING", [message("m1", [part(valid)], true)]))).toBeUndefined();
    expect(findAgentApprovalRequest(view("TASK_STATE_COMPLETED", [message("m1", [part(valid)], true)]))).toBeUndefined();
    expect(findAgentApprovalRequest(view("TASK_STATE_INPUT_REQUIRED", [message("m1", [part(valid)], false)]))).toBeUndefined(); // Not the status prompt.
    expect(findAgentApprovalRequest(view("TASK_STATE_INPUT_REQUIRED", [message("m1", [part(valid, "application/json")], true)]))).toBeUndefined();
    expect(findAgentApprovalRequest(view("MESSAGE_ONLY", [message("m1", [part(valid)], true)], "message"))).toBeUndefined();
    expect(findAgentApprovalRequest(view("TASK_STATE_INPUT_REQUIRED", [message("m1", [part({ ...valid, title: "" })], true)]))).toBeUndefined();
  });
});
