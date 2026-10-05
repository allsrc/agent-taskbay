"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { auditParams, describeEntry } from "@/lib/audit";
import { useServerResource } from "@/lib/use-server-resource";
import type { AuditGroup, AuditPageView } from "@/shared/audit-types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" });

/**
 * A read-only, newest-first trail. It refreshes its first page on live signals and loads older pages on request;
 * nothing here can change a record. Mount it with a `key` derived from its filters so a filter change starts fresh.
 */
export function AuditTrail({ taskId, group = "all", since, until, pageSize = 25, compact = false }: {
  taskId?: string; group?: AuditGroup; since?: string; until?: string; pageSize?: number; compact?: boolean }) {
  // The newest page rides the shared resource hook (live signals, focus and fallback polling); older pages load on request.
  const first = useServerResource<AuditPageView>(`/api/audit?${auditParams({ taskId, group, since, until, limit: pageSize })}`);
  const [older, setOlder] = useState<AuditPageView[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const loading = first.loading;
  const error = problem ?? first.error ?? null;
  const pages = first.data ? [first.data, ...older] : older;

  async function loadMore() {
    const cursor = pages.at(-1)?.next; if (!cursor) return;
    setMore(true); setProblem(null);
    try {
      const response = await fetch(`/api/audit?${auditParams({ taskId, group, since, until, cursor, limit: pageSize })}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not load older entries.");
      setOlder((previous) => [...previous, body as AuditPageView]);
    } catch (cause) { setProblem(cause instanceof Error ? cause.message : "Could not load older entries."); }
    finally { setMore(false); }
  }

  if (loading) return <p role="status" className="text-muted-foreground p-2 text-sm">Loading the audit trail…</p>;
  const viewer = pages[0]?.viewer;
  const people = Object.assign({}, ...pages.map((page) => page.people));
  const context = Object.assign({}, ...pages.map((page) => page.context));
  const seen = new Set<string>();
  const entries = pages.flatMap((page) => page.entries).filter((entry) => !seen.has(entry.key) && seen.add(entry.key));

  return (
    <div>
      {error && <p role="alert" className="text-brand mb-2 text-sm">{error}</p>}
      {entries.length === 0 && !error && <p className="text-muted-foreground p-2 text-sm">Nothing has been recorded here yet.</p>}
      <ol aria-label="Audit trail" className="flex flex-col">
        {entries.map((entry) => {
          const description = describeEntry(entry, people, viewer?.userId ?? "", viewer?.membershipId ?? "");
          const task = entry.taskId ? context[entry.taskId] : undefined;
          return (
            <li key={entry.key} className="border-border border-t py-2 first:border-t-0" data-kind={entry.kind}>
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 text-[13px] break-words">{description.summary}</span>
                <time dateTime={entry.at} className="text-muted-foreground shrink-0 font-mono text-[11px]">{when(entry.at)}</time>
              </div>
              {!compact && entry.taskId && (
                <p className="text-muted-foreground font-mono text-[11px]">
                  <Link href={`/tasks/${entry.taskId}`} className="text-primary hover:underline">{task?.title ?? "Task"}</Link>{task ? ` · ${task.agentName}` : ""}
                </p>
              )}
              {description.facts.length > 0 && (
                <details className="mt-1">
                  <summary className="text-primary cursor-pointer font-mono text-[11px]">Details</summary>
                  <dl className="mt-1 flex flex-col gap-1 text-[12px]">
                    {description.facts.map(([label, value]) => (
                      <div key={label} className={cn("flex gap-3", value.length > 60 && "flex-col gap-0.5")}>
                        <dt className="text-muted-foreground w-28 shrink-0 font-mono text-[11px]">{label}</dt>
                        <dd className="min-w-0 break-words whitespace-pre-wrap">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </li>
          );
        })}
      </ol>
      {pages.at(-1)?.next && <Button variant="outline" size="sm" className="mt-2" disabled={more} onClick={loadMore}>{more && <Loader2 className="animate-spin" />} Show older entries</Button>}
    </div>
  );
}
