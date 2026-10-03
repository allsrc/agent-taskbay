/** One SSE connection per tab; consumers always fetch scoped durable projections. */
const listeners = new Set<() => void>();
let source: EventSource | undefined;
let pending: ReturnType<typeof setTimeout> | undefined;

export function subscribeTaskFreshness(listener: () => void) {
  listeners.add(listener);
  if (!source && typeof EventSource !== "undefined") {
    source = new EventSource("/api/tasks/events");
    const invalidate = () => {
      if (pending !== undefined) return;
      pending = setTimeout(() => {
        pending = undefined;
        for (const callback of listeners) callback();
      }, 25);
    };
    // Every reconnect receives ready, including when all prior signals were lost.
    for (const event of ["ready", "freshness", "resync"]) source.addEventListener(event, invalidate);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      source?.close(); source = undefined;
      clearTimeout(pending); pending = undefined;
    }
  };
}
