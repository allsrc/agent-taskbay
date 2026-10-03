import { describe, expect, it } from "vitest";
import { applyEvents } from "./track-events";
import { MESSAGE_ONLY_STATE, type TrackedTask } from "../store/task-store";

const shell = (): TrackedTask => ({
  taskId: "",
  agentId: "a",
  agentName: "Agent",
  kind: "message",
  state: MESSAGE_ONLY_STATE,
  createdAt: "t",
  updatedAt: "t",
  messages: [{ id: "u1", role: "user", parts: [], timestamp: "t" }],
  artifacts: [],
});

describe("applyEvents", () => {
  it("tracks a Message-only response as a direct reply", () => {
    const next = applyEvents(
      [{ message: { messageId: "m1", contextId: "ctx", role: "ROLE_AGENT", parts: [{ text: "4" }] } }],
      shell(),
      "reply-1",
    );
    expect(next.taskId).toBe("reply-1");
    expect(next.kind).toBe("message");
    expect(next.contextId).toBe("ctx");
    expect(next.messages.map((message) => message.id)).toEqual(["u1", "m1"]);
  });

  it("tracks a Task with status history and the input-required prompt", () => {
    const events = [
      { task: { id: "t1", contextId: "ctx", status: { state: "TASK_STATE_SUBMITTED", timestamp: "2026-01-01T00:00:00Z" } } },
      { statusUpdate: { taskId: "t1", contextId: "ctx", status: { state: "TASK_STATE_WORKING", timestamp: "2026-01-01T00:00:01Z" } } },
      {
        statusUpdate: {
          taskId: "t1",
          contextId: "ctx",
          status: {
            state: "TASK_STATE_INPUT_REQUIRED",
            timestamp: "2026-01-01T00:00:02Z",
            message: { messageId: "q1", role: "ROLE_AGENT", parts: [{ text: "Which cabin?" }] },
          },
        },
      },
    ];
    const next = applyEvents(events, shell(), "reply-1");
    expect(next.kind).toBe("task");
    expect(next.taskId).toBe("t1");
    expect(next.state).toBe("TASK_STATE_INPUT_REQUIRED");
    expect(next.transitions?.map((item) => item.state)).toEqual([
      "TASK_STATE_SUBMITTED",
      "TASK_STATE_WORKING",
      "TASK_STATE_INPUT_REQUIRED",
    ]);
    expect(next.messages.at(-1)).toMatchObject({ id: "q1", fromStatus: true });
  });

  it("does not duplicate transitions when a snapshot restates the current state", () => {
    const base = { ...shell(), taskId: "t1", kind: "task" as const, state: "TASK_STATE_WORKING", transitions: [{ state: "TASK_STATE_WORKING", timestamp: "t" }] };
    const next = applyEvents([{ task: { id: "t1", status: { state: "TASK_STATE_WORKING" } } }], base, "t1");
    expect(next.transitions).toHaveLength(1);
  });
});
