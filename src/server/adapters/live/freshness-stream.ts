import type { FreshnessReader } from "../../application/ports/realtime";

/** Backpressure keeps at most one frame queued; every frame is an invalidation. */
export function freshnessStream(reader: FreshnessReader, organizationId: string, signal: AbortSignal,
  options: { pollMs?: number; resyncMs?: number; lifetimeMs?: number } = {}) {
  const encoder = new TextEncoder();
  const stop = new AbortController();
  let closed = false;
  let initialized = false;
  let token = "";
  let lastFrame = Date.now();
  let deadline: ReturnType<typeof setTimeout>;
  let close: () => void;
  const abort = () => close();
  const pause = () => new Promise<void>((resolve) => {
    if (stop.signal.aborted) return resolve();
    const done = () => { clearTimeout(timer); stop.signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, options.pollMs ?? 500);
    stop.signal.addEventListener("abort", done, { once: true });
  });
  const cleanup = () => {
    closed = true; stop.abort(); clearTimeout(deadline); signal.removeEventListener("abort", abort);
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      close = () => { if (!closed) { cleanup(); controller.close(); } };
      signal.addEventListener("abort", abort, { once: true });
      deadline = setTimeout(close, options.lifetimeMs ?? 55_000);
      if (signal.aborted) close();
    },
    async pull(controller) {
      try {
        while (!closed) {
          const current = await reader.readToken(organizationId);
          if (closed) return;
          const event = !initialized ? "ready" : current !== token ? "freshness" :
            Date.now() - lastFrame >= (options.resyncMs ?? 15_000) ? "resync" : undefined;
          if (event) {
            initialized = true; token = current; lastFrame = Date.now();
            controller.enqueue(encoder.encode(`retry: 1000\nevent: ${event}\ndata: {}\n\n`));
            return;
          }
          await pause();
        }
      } catch {
        if (!closed) { cleanup(); controller.error(new Error("Freshness stream unavailable.")); }
      }
    },
    cancel() { if (!closed) cleanup(); },
  });
}
