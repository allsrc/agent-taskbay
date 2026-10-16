import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandFailureError } from "@/lib/command-failure";
import { cancelOverHttp, initialRestart, outgoingFromParts, restartMessageId, restoreRestartAttachments, runRestart, type RestartProgress, type RestartSteps } from "@/lib/restart-task";
import { externalizeBinary } from "@/server/application/services/protocol-archive";
import { normalizeParts } from "@/lib/content";
import type { ArtifactStore } from "@/server/application/ports/artifact-store";

const refuse = (kind: string) => new CommandFailureError("agent said no", { kind });
function steps(overrides: Partial<RestartSteps> & { state?: string } = {}) {
  const calls: string[] = [];
  const value: RestartSteps = {
    prepare: overrides.prepare,
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
  it("preserves binary file content across archival and restores it before cancellation", async () => {
    const bytes = Uint8Array.from([0, 1, 128, 255, 10]);
    const raw = Buffer.from(bytes).toString("base64");
    const digest = "a".repeat(64);
    const store = { put: async () => ({ objectKey: `org/${digest}`, digest, sizeBytes: bytes.length }) } as unknown as ArtifactStore;
    const archived = await externalizeBinary({ parts: [{ text: "Use this" }, { raw, mediaType: "text/csv", filename: "a.csv" }] }, "org", store);
    const parts = outgoingFromParts(normalizeParts((archived.event as { parts: unknown[] }).parts));
    const fetchFile = vi.fn<(url: string) => Promise<Response>>(async () => new Response(bytes));
    vi.stubGlobal("fetch", fetchFile);
    let prepared = parts;
    const { value, calls } = steps({ prepare: async () => { prepared = await restoreRestartAttachments(parts); }, cancel: async () => {
      expect(prepared).toEqual([{ text: "Use this", mediaType: "text/plain" }, { raw, mediaType: "text/csv", filename: "a.csv" }]);
    } });
    expect((await run(value)).progress.start.status).toBe("done");
    expect(calls).toContain("start");
    expect(fetchFile.mock.calls[0][0]).toBe(`/api/artifacts/${digest}`);
    expect(await restoreRestartAttachments([{ url: "https://agent.test/file", mediaType: "text/csv" }])).toEqual([{ url: "https://agent.test/file", mediaType: "text/csv" }]);
    expect(fetchFile).toHaveBeenCalledTimes(1);
  });

  it("leaves work running when an attachment is missing or no longer authorized", async () => {
    for (const status of [403, 404]) {
      vi.stubGlobal("fetch", async () => new Response("", { status }));
      const { value, calls } = steps({ prepare: () => restoreRestartAttachments([{ url: `/api/artifacts/${"b".repeat(64)}`, mediaType: "text/csv" }]).then(() => {}) });
      expect((await run(value)).progress.start.status).toBe("skipped");
      expect(calls).toEqual([]);
    }
  });

  it("changes the retry identity only for a definite refusal", () => {
    const first = restartMessageId("m1");
    expect(first).toBe("restart-m1");
    expect(restartMessageId("m1", first, { kind: "uncertain", message: "unknown" })).toBe(first);
    expect(restartMessageId("m1", first, { message: "connection lost" })).toBe(first);
    expect(restartMessageId("m1", first, { kind: "content_type_not_supported", message: "refused" })).not.toBe(first);
    expect(restartMessageId("m1", first, { kind: "dispatch_failed", message: "never sent" })).not.toBe(first);
  });

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
