import { afterEach, expect, it, vi } from "vitest";
import type { AgentRecord, SubscriptionRecord, TaskRecord } from "../../domain/persistence-model";
import type { SubscriptionRepository } from "../ports/persistence";
import type { SubscriptionUnitOfWork } from "../ports/subscriptions";
import { SubscriptionWorker } from "./observe-subscription";
import { SUBSCRIPTION_LEASE_MS } from "./subscription-state";

afterEach(() => vi.useRealTimers());

it("SCL-001 renews a quiet stream lease and aborts observation when ownership is lost", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T00:00:00Z"));
  const now = new Date();
  const lease: SubscriptionRecord = { id: "lease", organizationId: "org", taskId: "local-task", status: "streaming",
    attempts: 1, leaseOwner: "owner", leaseUntil: new Date(now.getTime() + SUBSCRIPTION_LEASE_MS),
    availableAt: now, createdAt: now, updatedAt: now, lastError: null };
  const renew = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const finish = vi.fn().mockResolvedValue(false);
  const subscriptions = { claim: vi.fn().mockResolvedValue(lease), renew, finish } as unknown as SubscriptionRepository;
  const task = { id: "local-task", organizationId: "org", agentId: "agent", remoteTaskId: "remote", state: "TASK_STATE_WORKING" } as TaskRecord;
  const agent = { id: "agent", organizationId: "org", enabled: true } as AgentRecord;
  const work: SubscriptionUnitOfWork = { run: async (callback) => callback({ subscriptions,
    tasks: { findById: async () => task } as never, agents: { findById: async () => agent } as never }) };
  let activeSignal: AbortSignal | undefined;
  const ingest = vi.fn();
  const worker = new SubscriptionWorker(work, { subscribe: async (_agent, _task, signal) => {
    activeSignal = signal;
    return { events: (async function* () {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    })() };
  } }, { open: () => ingest });
  const running = worker.runOne("owner", new AbortController().signal);
  await vi.advanceTimersByTimeAsync(0);
  expect(activeSignal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(SUBSCRIPTION_LEASE_MS / 3);
  expect(renew).toHaveBeenCalledWith(lease, new Date(now.getTime() + 5000), new Date(now.getTime() + 20_000));
  expect(activeSignal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(SUBSCRIPTION_LEASE_MS / 3);
  await running;
  expect(activeSignal?.aborted).toBe(true);
  expect(ingest).not.toHaveBeenCalled();
  expect(finish).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
