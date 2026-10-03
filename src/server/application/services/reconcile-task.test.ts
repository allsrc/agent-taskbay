import { describe, expect, it, vi } from "vitest";
import { ReconciliationWorker } from "./reconcile-task";
import type { ReconciliationUnitOfWork } from "../ports/reconciliation";
import type { AgentRecord, SyncCursorRecord, TaskRecord } from "../../domain/persistence-model";

describe("REL-002 SCL-001 reconciliation lease heartbeat", () => {
  it("aborts a quiet read when ownership is lost and never ingests its late result", async () => {
    vi.useFakeTimers();
    try {
      const cursor = { id: "cursor", taskId: "task", organizationId: "org", agentId: "agent", leaseOwner: "owner", attempts: 1, pageToken: "", lastSyncedAt: null } as SyncCursorRecord;
      const task = { id: "task", remoteTaskId: "remote", tenant: "" } as TaskRecord;
      const renew = vi.fn().mockResolvedValue(false);
      const finish = vi.fn().mockResolvedValue(false);
      const ports = { agents: { findById: async () => ({ enabled: true } as AgentRecord) }, syncCursors: {
        claim: async () => cursor, knownTasks: async () => [task], renew, finish,
      } };
      const work = { run: async (callback: (value: typeof ports) => Promise<unknown>) => callback(ports) } as unknown as ReconciliationUnitOfWork;
      let readSignal!: AbortSignal;
      const ingest = vi.fn();
      const worker = new ReconciliationWorker(work, {
        get: async (_agent, _task, signal) => {
          readSignal = signal;
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
          return { task: { id: "remote", status: { state: "TASK_STATE_COMPLETED" } } };
        }, list: async () => ({ tasks: [], nextPageToken: "" }),
      }, { ingest });
      const running = worker.runOne("owner", new AbortController().signal);
      await vi.advanceTimersByTimeAsync(5000);
      await running;
      expect(readSignal.aborted).toBe(true);
      expect(renew).toHaveBeenCalledOnce();
      expect(ingest).not.toHaveBeenCalled();
      expect(finish).toHaveBeenCalledWith(cursor, expect.any(Date), expect.objectContaining({ status: "pending", lastError: "Task reconciliation unavailable; read retry scheduled." }));
    } finally { vi.useRealTimers(); }
  });
});
