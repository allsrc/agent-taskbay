import { describe, expect, it } from "vitest";
import { groupConversations } from "./conversations";
import { taskTitle } from "./task-view";
import type { DurableTaskView } from "../shared/task-types";

const task = (extra: Partial<DurableTaskView> = {}): DurableTaskView => ({ localId: "l", taskId: "3f9a2c1d-0000", tenant: "", agentId: "a", agentName: "Billing agent", kind: "task",
  state: "TASK_STATE_WORKING", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", messages: [], artifacts: [], referenceLinks: {}, ...extra });
const say = (role: "user" | "agent", text: string) => ({ id: `${role}-${text}`, role, parts: [{ kind: "text", mediaType: "text/plain", value: text }], timestamp: "2026-10-01T00:00:00Z" }) as DurableTaskView["messages"][number];

describe("title of a task another system started", () => {
  it("uses the task's own title first", () => {
    expect(taskTitle(task({ origin: "discovered", title: "Reconcile invoices", messages: [say("agent", "Hi")] }))).toBe("Reconcile invoices");
  });
  it("uses a person's first message when there is one", () => {
    expect(taskTitle(task({ origin: "discovered", messages: [say("agent", "Hi"), say("user", "Please check")] }))).toBe("Please check");
  });
  it("uses the first thing the agent said when nobody wrote to it", () => {
    expect(taskTitle(task({ origin: "discovered", messages: [say("agent", "Which ledger should I use?")] }))).toBe("Which ledger should I use?");
  });
  it("falls back to a short task ID, never the agent's name", () => {
    expect(taskTitle(task({ origin: "discovered" }))).toBe("Task 3f9a2c1d");
  });
  it("is unchanged for a task started from Taskbay", () => {
    expect(taskTitle(task())).toBe("Billing agent");
    expect(taskTitle(task({ messages: [say("agent", "Hi")] }))).toBe("Billing agent");
  });
});

describe("title of a conversation another system started", () => {
  it("is named after the task, not the agent", () => {
    const [conversation] = groupConversations([task({ origin: "discovered", contextId: "c", messages: [say("agent", "Which ledger should I use?")] })]);
    expect(conversation.title).toBe("Which ledger should I use?");
    expect(groupConversations([task({ origin: "discovered", contextId: "c" })])[0].title).toBe("Task 3f9a2c1d");
  });
  it("still starts from the person's message, and keeps the agent's name for plain tasks", () => {
    expect(groupConversations([task({ contextId: "c", messages: [say("user", "Deploy it")] })])[0].title).toBe("Deploy it");
    expect(groupConversations([task({ contextId: "c" })])[0].title).toBe("Billing agent");
  });
});
