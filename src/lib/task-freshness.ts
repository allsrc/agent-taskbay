/** One SSE connection per tab; consumers always fetch scoped durable projections. */
const STALE_MS = 20_000; // The server sends a frame at least every 15 s.
const RECONNECT_GRACE_MS = 5_000; // EventSource retries after 1 s; a healthy stream sends `ready` at once.
const FALLBACK_MS = 5_000;

const listeners = new Set<() => void>();
let source: EventSource | undefined;
let pending: ReturnType<typeof setTimeout> | undefined;
let watchdog: ReturnType<typeof setTimeout> | undefined;
let fallback: ReturnType<typeof setTimeout> | undefined;

const notify = () => { for (const callback of listeners) callback(); };

/** Polling exists only while the stream is down; jitter keeps tabs from polling in lockstep. */
function startFallback() {
  if (fallback !== undefined) return;
  const tick = () => {
    fallback = setTimeout(() => { notify(); if (fallback !== undefined) tick(); }, FALLBACK_MS * (1 + Math.random() * 0.5));
  };
  tick();
}
function stopFallback() { clearTimeout(fallback); fallback = undefined; }
function armWatchdog(ms: number) { clearTimeout(watchdog); watchdog = setTimeout(startFallback, ms); }

export function subscribeTaskFreshness(listener: () => void) {
  listeners.add(listener);
  if (!source) {
    if (typeof EventSource === "undefined") startFallback();
    else {
      source = new EventSource("/api/tasks/events");
      const invalidate = () => {
        stopFallback(); armWatchdog(STALE_MS);
        if (pending !== undefined) return;
        pending = setTimeout(() => { pending = undefined; notify(); }, 25);
      };
      // Every reconnect receives ready, including when all prior signals were lost.
      for (const event of ["ready", "freshness", "resync"]) source.addEventListener(event, invalidate);
      source.addEventListener("error", () => armWatchdog(RECONNECT_GRACE_MS));
      armWatchdog(RECONNECT_GRACE_MS);
    }
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      source?.close(); source = undefined;
      clearTimeout(pending); pending = undefined;
      clearTimeout(watchdog); watchdog = undefined;
      stopFallback();
    }
  };
}
