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
    let timer: ReturnType<typeof setTimeout>;
    const load = queuedRead(async () => {
      const revision = useTaskStore.getState().revision;
      try {
        const tasks = await readDurableTasks(controller.signal);
        if (!controller.signal.aborted && !useTaskStore.getState().replaceTasks(tasks, revision)) void load();
      } catch (error) {
        if (!controller.signal.aborted) useTaskStore.getState().fail(error instanceof Error ? error.message : "Could not load server tasks.");
      }
    }, controller.signal);
    const poll = async () => {
      await load();
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    };
    void poll();
    const onFocus = () => { void load(); };
    const unsubscribe = subscribeTaskFreshness(onFocus);
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); clearTimeout(timer); unsubscribe(); window.removeEventListener("focus", onFocus); };
  }, []);
  return null;
}
