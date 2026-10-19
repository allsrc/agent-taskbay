import { createNotificationDelivery, createNotificationFanout } from "../runtime/notifications";
import { reportRetry } from "./report";

/** Turns queued events into inbox rows, then delivers each through the external channel when one is configured. */
export function startNotificationLoop() {
  const fanout = createNotificationFanout();
  let delivery: ReturnType<typeof createNotificationDelivery>;
  try { delivery = createNotificationDelivery(); } catch (error) { console.error(error instanceof Error ? error.message : "Notification channel is misconfigured."); }
  const shutdown = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  const tick = async () => {
    try { for (let count = 0; count < 100 && !shutdown.signal.aborted; count++) if (!await fanout.runOne()) break; }
    catch (error) { reportRetry("Notification fan-out", error); }
    try { for (let count = 0; count < 20 && delivery && !shutdown.signal.aborted; count++) if (!await delivery.runOne(shutdown.signal)) break; }
    catch (error) { reportRetry("Notification delivery", error); }
    if (!shutdown.signal.aborted) { timer = setTimeout(() => { running = tick(); }, 250); timer.unref?.(); }
  };
  running = tick();
  return async () => { shutdown.abort(); clearTimeout(timer); await running; };
}

type WorkerGlobal = typeof globalThis & { __a2aNotificationLoopStop?: () => Promise<void> };
export function startEmbeddedNotificationLoop() {
  const state = globalThis as WorkerGlobal;
  state.__a2aNotificationLoopStop ??= startNotificationLoop();
}
