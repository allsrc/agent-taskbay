import Link from "next/link";
import { Button } from "@/components/ui/button";
import { InfoCard, StateChip } from "@/components/a2a/primitives";
import { Eyebrow } from "@/components/patterns/status";
import type { RelatedTasks as RelatedTasksView } from "@/shared/task-types";

/** Only authorized summaries reach this component; remote IDs and titles never choose the destination. */
export function RelatedTasks({ related, onCancelRelated }: { related?: RelatedTasksView; onCancelRelated?: () => void }) {
  if (!related || !related.references.length && !related.referencedBy.length) return null;
  return <InfoCard label="Related tasks">
    <div className="space-y-4">
      {([["References", related.references], ["Referenced by", related.referencedBy]] as const).map(([label, tasks]) => tasks.length > 0 &&
        <section key={label} aria-label={label}>
          <Eyebrow>{label}</Eyebrow>
          <ul className="mt-1 divide-y">
            {tasks.map((task) => <li key={task.localId} className="flex flex-wrap items-center gap-2 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1 basis-40">
                <Link href={`/tasks/${encodeURIComponent(task.localId)}`} className="block text-sm font-medium [overflow-wrap:anywhere] hover:underline">
                  {task.title || `Task ${task.taskId.slice(0, 8)}`}
                </Link>
                <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{task.agentName}</span>
              </div>
              <StateChip state={task.state} />
            </li>)}
          </ul>
        </section>)}
      {onCancelRelated && <Button variant="outline" className="max-w-full whitespace-normal" onClick={onCancelRelated}>Cancel this and related</Button>}
    </div>
  </InfoCard>;
}
