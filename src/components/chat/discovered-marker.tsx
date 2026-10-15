import { relativeTime } from "@/lib/task-view";
import type { TrackedTask } from "@/shared/task-types";

/** Shown at the start of a conversation about a task another system started, where there is no first message from a person. */
export function DiscoveredMarker({ task, now }: { task: Pick<TrackedTask, "createdAt" | "discoveredAt">; now: number }) {
  const found = task.discoveredAt ?? task.createdAt;
  return <p className="text-muted-foreground text-center text-xs">Started outside Taskbay · found {relativeTime(found, now)} ago</p>;
}
