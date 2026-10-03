/** Coalesce overlapping invalidations, preserving one read after an in-flight request. */
export function queuedRead(read: () => Promise<void>, signal: AbortSignal) {
  let running = false;
  let queued = false;
  return async () => {
    if (signal.aborted) return;
    if (running) { queued = true; return; }
    running = true;
    try {
      do {
        queued = false;
        await read();
      } while (queued && !signal.aborted);
    } finally { running = false; }
  };
}
