import { afterEach, expect, it, vi } from "vitest";
import type { AgentRecord, PushRegistrationRecord, TaskRecord } from "../../domain/persistence-model";
import type { PushRepository, PushUnitOfWork } from "../ports/push";
import { PushLifecycleWorker, PUSH_LEASE_MS } from "./push-lifecycle";

afterEach(() => vi.useRealTimers());
it("SCL-001 renews push registration leases and aborts calls after ownership loss", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T00:00:00Z"));
  const lease = { id: "config", organizationId: "org", taskId: "local", desired: true, status: "registering", attempts: 1 } as PushRegistrationRecord;
  const renew = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const finish = vi.fn().mockResolvedValue(false);
  const push = { retireDisabled: async () => undefined, claim: async () => lease, renew, finish } as unknown as PushRepository;
  const task = { id: "local", agentId: "agent", remoteTaskId: "remote", state: "TASK_STATE_WORKING" } as TaskRecord;
  const agent = { id: "agent", enabled: true } as AgentRecord;
  const work: PushUnitOfWork = { run: async (callback) => callback({ push, tasks: { findById: async () => task } as never,
    agents: { findById: async () => agent } as never }) };
  let signal: AbortSignal | undefined;
  const worker = new PushLifecycleWorker(work, { register: async (_agent, _task, _id, _url, _token, active) => {
    signal = active;
    await new Promise<void>((_resolve, reject) => active.addEventListener("abort", () => reject(new Error("Lost lease")), { once: true }));
  }, remove: async () => undefined }, { callbackUrl: () => "https://console.test", token: () => "server-secret", authenticate: () => true });
  const running = worker.runOne("owner", new AbortController().signal);
  await vi.advanceTimersByTimeAsync(0); expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(PUSH_LEASE_MS / 3); expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(PUSH_LEASE_MS / 3); await running;
  expect(signal?.aborted).toBe(true); expect(renew).toHaveBeenCalledTimes(2); expect(finish).toHaveBeenCalledOnce();
  expect(finish.mock.calls[0][2]).toMatchObject({ status: "pending", lastError: "Push configuration unavailable; retry scheduled." });
  expect(vi.getTimerCount()).toBe(0);
});
