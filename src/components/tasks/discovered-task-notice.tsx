"use client";

import { useSyncExternalStore } from "react";
import { Callout } from "@/components/patterns/data-display";
import { Button } from "@/components/ui/button";
import type { TrackedTask } from "@/shared/task-types";

const key = (localId: string) => `agent-taskbay-discovered-notice:${localId}`;
// Dismissal is a per-browser convenience. It is kept in memory too, so it still works when storage is blocked or throws.
const dismissedHere = new Set<string>();
const listeners = new Set<() => void>();
function isDismissed(localId: string) {
  if (dismissedHere.has(localId)) return true;
  try { return window.localStorage.getItem(key(localId)) === "dismissed"; } catch { return false; }
}
function dismiss(localId: string) {
  dismissedHere.add(localId);
  try { window.localStorage.setItem(key(localId), "dismissed"); } catch { /* the notice just comes back next time */ }
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { listeners.delete(listener); window.removeEventListener("storage", listener); };
}

/** What a person should know about a task another system started. */
export function DiscoveredTaskNotice({ task }: { task: Pick<TrackedTask, "origin" | "trackedBy" | "discoveredAt"> & { localId: string } }) {
  const dismissed = useSyncExternalStore(subscribe, () => isDismissed(task.localId), () => false);
  if (task.origin !== "discovered" || dismissed) return null;
  const who = task.trackedBy ? ` Tracked by ${task.trackedBy.name}${task.discoveredAt ? ` on ${task.discoveredAt.slice(0, 10)}` : ""}.` : "";
  return (
    <Callout tone="info" title="Started outside Taskbay" className="mb-4"
      action={<Button size="sm" variant="ghost" onClick={() => dismiss(task.localId)}>Dismiss</Button>}>
      You can answer it, send it more input or cancel it here.{who}
    </Callout>
  );
}
