import { expect, it, vi } from "vitest";
import type { DurableTaskView } from "../shared/task-types";
import { sendAndStream } from "./client-stream";
import { runResubscribe, runSend } from "./run-message";

vi.mock("./client-stream", () => ({ sendAndStream: vi.fn() }));

it("TSK-002 uses committed snapshots without replaying old transitions into the chat cache", async () => {
  const view: DurableTaskView = { localId: "local", tenant: "", taskId: "remote", agentId: "agent", agentName: "Agent",
    kind: "task", state: "TASK_STATE_INPUT_REQUIRED", createdAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T00:00:02Z",
    messages: [], artifacts: [], transitions: [{ state: "TASK_STATE_WORKING", timestamp: "2026-10-03T00:00:00Z" },
      { state: "TASK_STATE_INPUT_REQUIRED", timestamp: "2026-10-03T00:00:02Z" }], referenceLinks: {} };
  const replay = { task: { id: "remote", status: { state: "TASK_STATE_WORKING" } } };
  vi.mocked(sendAndStream).mockImplementation(async (_agent, _body, callbacks) => {
    callbacks.onSnapshot?.(view); callbacks.onEvent?.(replay);
  });
  const onUpdate = vi.fn();
  const onRawEvent = vi.fn();
  expect(await runSend({ agentId: "agent", agentName: "Agent", parts: [{ text: "Reply", mediaType: "text/plain" }], base: view,
    userMessage: { id: "user", role: "user", parts: [], timestamp: view.createdAt } }, { onUpdate, onRawEvent })).toEqual(view);
  expect(onUpdate).toHaveBeenCalledExactlyOnceWith(view);
  expect(onRawEvent).toHaveBeenCalledExactlyOnceWith(replay);
  onUpdate.mockClear();
  await runResubscribe(view, { onUpdate });
  expect(onUpdate).toHaveBeenCalledExactlyOnceWith(view);
});

it("TSK-002 never makes raw diagnostic events authoritative, even before the first snapshot", async () => {
  vi.mocked(sendAndStream).mockImplementation(async (_agent, _body, callbacks) => {
    callbacks.onEvent?.({ task: { id: "uncommitted", status: { state: "TASK_STATE_COMPLETED" } } });
  });
  const onUpdate = vi.fn();
  expect(await runSend({ agentId: "agent", agentName: "Agent", parts: [{ text: "Send", mediaType: "text/plain" }],
    userMessage: { id: "pending", role: "user", parts: [], timestamp: "2026-10-03T00:00:00Z" } }, { onUpdate })).toBeUndefined();
  expect(onUpdate).not.toHaveBeenCalled();
});
