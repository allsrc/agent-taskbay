import Link from "next/link";
import { InfoCard, StateChip } from "@/components/a2a/primitives";
import { relativeTime } from "@/lib/task-view";
import { contextListHref } from "@/lib/task-list-query";
import type { ContextSibling } from "@/shared/task-types";

/** Other tasks the agent holds in the same context. Hidden when there are none. Titles are agent text and render as plain text. */
export function ContextSiblings({ siblings, contextId, agentId, now }: { siblings: ContextSibling[] | undefined; contextId: string | undefined; agentId: string; now?: number }) {
  if (!siblings?.length || !contextId) return null;
  return (
    <InfoCard label="Other tasks in this context">
      <ul className="divide-y">
        {siblings.map((sibling) => (
          <li key={sibling.localId} className="flex items-center gap-2 py-2.5 first:pt-0 last:pb-0">
            <Link href={`/tasks/${sibling.localId}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
              {sibling.title || `Task ${sibling.taskId.slice(0, 8)}`}
            </Link>
            <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">{relativeTime(sibling.updatedAt, now)}</span>
            <StateChip state={sibling.state} />
          </li>
        ))}
      </ul>
      <Link href={contextListHref(contextId, agentId)} className="mt-3 inline-block text-sm text-brand-text hover:underline">Show all in the Tasks list</Link>
    </InfoCard>
  );
}
