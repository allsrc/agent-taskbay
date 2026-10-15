import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandFailureError } from "@/lib/command-failure";
import { cancelOverHttp, initialRestart, outgoingFromParts, runRestart, type RestartProgress, type RestartSteps } from "@/lib/restart-task";

const refuse = (kind: string) => new CommandFailureError("agent said no", { kind });
function steps(overrides: Partial<RestartSteps> & { state?: string } = {}) {
  const calls: string[] = [];
  const value: RestartSteps = {
    cancel: overrides.cancel ?? (async () => { calls.push("cancel"); }),
    readState: overrides.readState ?? (async () => { calls.push("read"); return overrides.state ?? "TASK_STATE_CANCELED"; }),
    start: overrides.start ?? (async () => { calls.push("start"); }),
  };
  return { value, calls };
}
const run = (value: RestartSteps, from: "cancel" | "start" = "cancel", start?: RestartProgress) => {
  const seen: RestartProgress[] = [];
  return runRestart(value, from, (progress) => seen.push(progress), start).then((progress) => ({ progress, seen }));
};

afterEach(() => vi.unstubAllGlobals());

describe("stop and restart with this instruction", () => {
  it("cancels, checks the task is canceled, then starts the new task", async () => {
    const order: string[] = [];
    const { value } = steps({ cancel: async () => { order.push("cancel"); }, readState: async () => { order.push("read"); return "TASK_STATE_CANCELED"; }, start: async () => { order.push("start"); } });
    const { progress, seen } = await run(value);
    expect(order).toEqual(["cancel", "read", "start"]);
    expect(progress).toMatchObject({ cancel: { status: "done" }, start: { status: "done" } });
    expect(seen[0].cancel.status).toBe("running");
  });

  it("does not start when the agent refuses the cancel, and leaves the task alone", async () => {
    for (const kind of ["unsupported_operation", "uncertain", "task_not_found"]) {
      const { value, calls } = steps({ cancel: async () => { throw refuse(kind); } });
      const { progress } = await run(value);
      expect(progress.cancel).toMatchObject({ status: "failed", failure: { kind } });
      expect(progress.start.status).toBe("skipped");
      expect(calls).not.toContain("start");
    }
  });

  it("does not start when the cancel was accepted but the task is not canceled", async () => {
    const { value, calls } = steps({ state: "TASK_STATE_WORKING" });
    const { progress } = await run(value);
    expect(progress.cancel.status).toBe("failed");
    expect(progress.start.status).toBe("skipped");
    expect(calls).not.toContain("start");
    const unreadable = steps({ readState: async () => undefined });
    expect((await run(unreadable.value)).progress.start.status).toBe("skipped");
  });

  it("treats a task that is already finished as ready, but not one that is still working", async () => {
    for (const kind of ["task_terminal", "task_not_cancelable"]) {
      const finished = steps({ cancel: async () => { throw refuse(kind); }, state: "TASK_STATE_COMPLETED" });
      const { progress } = await run(finished.value);
      expect(progress.cancel).toMatchObject({ status: "done", alreadyFinished: true });
      expect(progress.start.status).toBe("done");
      const working = steps({ cancel: async () => { throw refuse(kind); }, state: "TASK_STATE_WORKING" });
      const blocked = (await run(working.value)).progress;
      expect(blocked.cancel).toMatchObject({ status: "failed", failure: { kind: "task_not_cancelable" } });
      expect(blocked.start.status).toBe("skipped");
      expect(working.calls).not.toContain("start");
    }
  });

  it("keeps the cancel when the new task fails, and retries only the second step", async () => {
    let attempts = 0, cancels = 0;
    const { value } = steps({ cancel: async () => { cancels++; }, start: async () => { if (++attempts === 1) throw refuse("content_type_not_supported"); } });
    const first = (await run(value)).progress;
    expect(first.cancel.status).toBe("done");
    expect(first.start).toMatchObject({ status: "failed", failure: { kind: "content_type_not_supported" } });
    const second = (await run(value, "start", first)).progress;
    expect(second).toMatchObject({ cancel: { status: "done" }, start: { status: "done" } });
    expect(cancels).toBe(1);
    expect(attempts).toBe(2);
  });

  it("sends the cancel with a fixed idempotency key so a repeat does not create a second command", async () => {
    const seen: Array<{ url: string; key: string | null }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({ url, key: new Headers(init.headers).get("Idempotency-Key") });
      return seen.length === 1 ? new Response("{}", { status: 200 })
        : new Response(JSON.stringify({ error: { message: "finished", kind: "task_terminal" } }), { status: 409 });
    });
    const task = { agentId: "a1", taskId: "t 1", tenant: "acme" };
    await cancelOverHttp(task, "restart-cancel-m1-0");
    await expect(cancelOverHttp(task, "restart-cancel-m1-0")).rejects.toMatchObject({ kind: "task_terminal", status: 409 });
    expect(seen.map((call) => call.key)).toEqual(["restart-cancel-m1-0", "restart-cancel-m1-0"]);
    expect(seen[0].url).toBe("/api/agents/a1/tasks/t%201/cancel?tenant=acme");
  });

  it("resends what the message carried and skips what it cannot read back", () => {
    expect(outgoingFromParts([
      { id: "1", kind: "text", value: "Use March", mediaType: "text/plain" },
      { id: "2", kind: "data", value: { month: 3 }, mediaType: "application/json" },
      { id: "3", kind: "url", value: "https://files.test/a.csv", mediaType: "text/csv", filename: "a.csv" },
      { id: "4", kind: "unknown", value: {}, mediaType: "application/octet-stream" },
    ])).toEqual([
      { text: "Use March", mediaType: "text/plain" }, { data: { month: 3 }, mediaType: "application/json" },
      { url: "https://files.test/a.csv", mediaType: "text/csv", filename: "a.csv" },
    ]);
    expect(initialRestart()).toEqual({ cancel: { status: "waiting" }, start: { status: "waiting" } });
  });
});
