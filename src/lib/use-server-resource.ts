"use client";

import { useEffect, useReducer, useState } from "react";
import { subscribeTaskFreshness } from "./task-freshness";
import { queuedRead } from "./queued-read";

/** Read after live invalidations, with focus and periodic recovery for missed signals. */
export function useServerResource<T>(url: string | null) {
  const [state, setState] = useState<{ url: string | null; data?: T; error?: string; loading: boolean }>({ url, loading: true });
  const [revision, refresh] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = queuedRead(async () => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? "Could not load server state.");
        if (!controller.signal.aborted) setState({ url, data: body as T, loading: false });
      } catch (error) {
        if (!controller.signal.aborted) setState((previous) => ({
          url, data: previous.url === url ? previous.data : undefined,
          error: error instanceof Error ? error.message : "Could not load server state.", loading: false,
        }));
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
  }, [url, revision]);
  return {
    data: state.url === url ? state.data : undefined,
    error: state.url === url ? state.error : undefined,
    loading: state.url === url ? state.loading : true,
    refresh,
  };
}
