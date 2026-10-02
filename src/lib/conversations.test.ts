import { describe, expect, it } from "vitest";
import { findConversation, groupConversations, isOpenTask } from "./conversations";
import type { TrackedTask } from "../store/task-store";

const make = (over: Partial<TrackedTask>): TrackedTask => ({
  taskId: "t",
  agentId: "a",
  agentName: "Agent",
  kind: "task",
  state: "TASK_STATE_COMPLETED",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  messages: [{ id: "u", role: "user", parts: [{ id: "p", kind: "text", value: "Plan my trip", mediaType: "text/plain" }], timestamp: "t" }],
  artifacts: [],
  ...over,
});

describe("groupConversations", () => {
  it("groups several tasks under one contextId, oldest first", () => {
    const [conversation] = groupConversations([
      make({ taskId: "t2", contextId: "ctx", createdAt: "2026-01-01T00:02:00Z" }),
      make({ taskId: "t1", contextId: "ctx", createdAt: "2026-01-01T00:01:00Z" }),
    ]);
    expect(conversation.tasks.map((task) => task.taskId)).toEqual(["t1", "t2"]);
    expect(conversation.title).toBe("Plan my trip");
  });

  it("surfaces input-required over later completed tasks", () => {
    const [conversation] = groupConversations([
      make({ taskId: "t1", contextId: "ctx", state: "TASK_STATE_INPUT_REQUIRED" }),
      make({ taskId: "t2", contextId: "ctx", createdAt: "2026-01-02T00:00:00Z" }),
    ]);
    expect(conversation.bucket).toBe("needs-input");
  });

  it("keeps context-less direct replies standalone", () => {
    const conversations = groupConversations([
      make({ taskId: "reply-1", kind: "message", state: "MESSAGE_ONLY" }),
      make({ taskId: "reply-2", kind: "message", state: "MESSAGE_ONLY" }),
    ]);
    expect(conversations).toHaveLength(2);
    expect(conversations[0].bucket).toBe("replies");
  });

  it("only treats non-terminal tasks as open", () => {
    expect(isOpenTask(make({ state: "TASK_STATE_WORKING" }))).toBe(true);
    expect(isOpenTask(make({ state: "TASK_STATE_CANCELED" }))).toBe(false);
    expect(isOpenTask(make({ kind: "message", state: "MESSAGE_ONLY" }))).toBe(false);
  });
});


describe("scoped context identity", () => {
  it("separates identical contexts across agents and tenants", () => {
    const conversations = groupConversations([
      make({ contextId: "same", agentId: "a" }),
      make({ contextId: "same", agentId: "b" }),
      make({ contextId: "same", agentId: "a", tenant: "other" }),
    ]);
    expect(conversations).toHaveLength(3);
    expect(findConversation(conversations, "same")).toBeUndefined();
    expect(findConversation(conversations, conversations[0].key)).toBe(conversations[0]);
  });
  it("resolves an old context-only link when it is unambiguous", () => {
    const conversations = groupConversations([make({ contextId: "legacy" })]);
    expect(findConversation(conversations, "legacy")).toBe(conversations[0]);
  });
});
