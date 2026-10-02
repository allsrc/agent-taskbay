"use client";

import { useEffect, useReducer, useState } from "react";

/** Poll committed state; a missed browser stream is recovered by the next read. */
export function useServerResource<T>(url: string) {
  const [state, setState] = useState<{ url: string; data?: T; error?: string; loading: boolean }>({ url, loading: true });
  const [revision, refresh] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    const load = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
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
      } finally { inFlight = false; }
    };
    const poll = async () => {
      await load();
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    };
    void poll();
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener("focus", onFocus); };
  }, [url, revision]);
  return {
    data: state.url === url ? state.data : undefined,
    error: state.url === url ? state.error : undefined,
    loading: state.url === url ? state.loading : true,
    refresh,
  };
}
