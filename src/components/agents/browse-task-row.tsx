import Link from "next/link";
import { Loader2 } from "lucide-react";
import { StateChip } from "@/components/a2a/primitives";
import { Identifier } from "@/components/patterns/identifier";
import { CommandError } from "@/components/a2a/command-error";
import { Button, buttonVariants } from "@/components/ui/button";
import type { BrowseRowView } from "@/lib/browse-tasks";
import type { CommandFailure } from "@/lib/command-failure";
import { relativeTime } from "@/lib/task-view";

/**
 * One task on the agent. Everything here came from the agent: it is shown as text, never as markup or a link, and never chooses a label or a color.
 * Rendering is static so it can be checked without a browser; the dialog supplies the actions.
 */
export function BrowseTaskRow({ row, busy, failure, onTrack, now }: {
  row: BrowseRowView;
  busy?: boolean;
  failure?: CommandFailure;
  onTrack?: () => void;
  /** The time the list was read, so ages stay stable while it is shown. */
  now: number;
}) {
  const label = row.title ?? `Task ${row.taskId.slice(0, 8)}`;
  return (
    <li className="space-y-1.5 px-1 py-3 first:pt-1 last:pb-1">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
        <StateChip state={row.state} />
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
        <Identifier kind="task" value={row.taskId} />
        {row.contextId && <Identifier kind="context" value={row.contextId} />}
        {row.updatedAt && <span className="font-mono">updated {relativeTime(row.updatedAt, now)}</span>}
      </div>
      <div className="flex items-center gap-3">
        <p className="text-muted-foreground min-w-0 flex-1 text-sm">{row.snippet ? <>“{row.snippet}”</> : null}</p>
        {row.tracked && row.localId ? (
          <>
            <span className="text-muted-foreground text-xs">Tracked</span>
            <Link href={`/tasks/${row.localId}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`Open ${label}`}>Open</Link>
          </>
        ) : (
          <Button size="sm" variant="outline" disabled={busy || !onTrack} onClick={onTrack} aria-label={`Track ${label}`}>
            {busy && <Loader2 className="animate-spin" />} Track
          </Button>
        )}
      </div>
      {failure && <CommandError failure={failure} onRetry={onTrack} />}
    </li>
  );
}
