import { afterEach, describe, expect, it, vi } from "vitest";
import { sendAndStream } from "./client-stream";

afterEach(() => vi.unstubAllGlobals());
describe("durable stream delivery", () => {
  it("delivers the authoritative snapshot before replayed diagnostic events", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('event: snapshot\ndata: {"localId":"local","state":"TASK_STATE_INPUT_REQUIRED"}\n\nevent: a2a\ndata: {"task":{"status":{"state":"TASK_STATE_WORKING"}}}\n\n')));
    await sendAndStream("agent", { taskId: "remote", resubscribe: true }, { onSnapshot: () => calls.push("snapshot"), onEvent: () => calls.push("event") });
    expect(calls).toEqual(["snapshot", "event"]);
  });
  it("exposes accepted command identity before durable task events", async () => {
    const onAccepted = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('event: accepted\ndata: {"commandId":"command"}\n\n')));
    await sendAndStream("agent", { text: "Work" }, { onAccepted });
    expect(onAccepted).toHaveBeenCalledWith("command");
  });
  it("delivers committed task identity before its protocol event", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('event: persisted\ndata: {"localId":"local","taskId":"remote","tenant":"one"}\n\nevent: a2a\ndata: {"task":{"id":"remote"}}\n\n')));
    await sendAndStream("agent", { text: "Work" }, { onTaskIdentity: () => calls.push("identity"), onEvent: () => calls.push("event") });
    expect(calls).toEqual(["identity", "event"]);
  });
  it("reports and rejects a persistence error instead of reporting stream success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('event: error\ndata: {"message":"Persistence failed"}\n\n')));
    const onError = vi.fn();
    await expect(sendAndStream("agent", { text: "Work" }, { onError })).rejects.toThrow("Persistence failed");
    expect(onError).toHaveBeenCalledWith("Persistence failed");
  });
});
