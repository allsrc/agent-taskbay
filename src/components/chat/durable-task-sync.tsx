"use client";

import { useEffect } from "react";
import { readDurableTasks } from "@/lib/durable-task-cache";
import { queuedRead } from "@/lib/queued-read";
import { subscribeTaskFreshness } from "@/lib/task-freshness";
import { useTaskStore } from "@/store/task-store";

/** One complete projection cache per tab, independent of previously visited tasks. */
export function DurableTaskSync() {
  useEffect(() => {
    const controller = new AbortController();
    const load = queuedRead(async () => {
      const revision = useTaskStore.getState().revision;
      try {
        const tasks = await readDurableTasks(controller.signal);
        if (!controller.signal.aborted && !useTaskStore.getState().replaceTasks(tasks, revision)) void load();
      } catch (error) {
        if (!controller.signal.aborted) useTaskStore.getState().fail(error instanceof Error ? error.message : "Could not load server tasks.");
      }
    }, controller.signal);
    void load();
    const onFocus = () => { void load(); };
    const unsubscribe = subscribeTaskFreshness(onFocus);
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); unsubscribe(); window.removeEventListener("focus", onFocus); };
  }, []);
  return null;
}
