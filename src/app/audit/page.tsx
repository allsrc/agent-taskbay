"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Download, ScrollText } from "lucide-react";
import { AuditTrail } from "@/components/audit/audit-trail";
import { EmptyState } from "@/components/a2a/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { auditParams, GROUP_LABEL } from "@/lib/audit";
import { useServerResource } from "@/lib/use-server-resource";
import type { AuditGroup } from "@/shared/audit-types";
import { cn } from "@/lib/utils";

const GROUPS = Object.keys(GROUP_LABEL) as AuditGroup[];

function AuditPage() {
  const taskId = useSearchParams().get("taskId") ?? undefined;
  const [group, setGroup] = useState<AuditGroup>("all");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  // The same endpoint answers who may see what: a 403 means this member may only open a single task's trail.
  const probe = useServerResource<{ viewer: { role: string } }>(`/api/audit?${auditParams({ taskId, limit: 1 })}`);
  const admin = probe.data?.viewer.role === "admin";

  if (probe.loading) return <div className="p-6" role="status">Loading audit trail…</div>;
  if (!probe.data) {
    return (
      <EmptyState icon={<ScrollText className="size-7" />} title={taskId ? "Task not found" : "Administrators only"}>
        {taskId ? "This task is not available to you." : "The organization-wide audit trail is limited to administrators. Open a task to see its own trail."}{" "}
        <Link href="/tasks" className="text-primary hover:underline">Back to tasks</Link>
      </EmptyState>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 pb-24 md:p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <h1 className="min-w-40 flex-1 font-mono text-lg font-bold tracking-tight">{taskId ? "Task audit trail" : "Audit trail"}</h1>
        {taskId && <Button variant="outline" size="sm" asChild><Link href={`/tasks/${taskId}`}>Back to task</Link></Button>}
        {admin && <Button variant="outline" size="sm" asChild>
          <a href={`/api/audit/export?${auditParams({ taskId, group, since, until, limit: 200 })}`} download="audit-trail.csv"><Download /> Export CSV</a></Button>}
      </div>
      <p className="text-muted-foreground mb-3 max-w-2xl text-[13px]">
        A permanent, read-only record of who did what and when. Entries cannot be edited or removed. Internal note text is never shown here.
      </p>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter the audit trail">
          {GROUPS.filter((name) => admin || name === "all" || name === "approvals" || name === "ownership").map((name) => (
            <button key={name} role="tab" aria-selected={group === name} onClick={() => setGroup(name)}
              className={cn("rounded-full border px-2.5 py-1 font-mono text-xs font-medium transition-colors",
                group === name ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground")}>{GROUP_LABEL[name]}</button>
          ))}
        </div>
        <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
          <div className="flex min-w-[10rem] flex-1 flex-col gap-1"><Label htmlFor="audit-since" className="text-[11px]">From</Label><Input id="audit-since" type="datetime-local" className="h-8 min-w-0 text-xs" value={since} onChange={(event) => setSince(event.target.value)} /></div>
          <div className="flex min-w-[10rem] flex-1 flex-col gap-1"><Label htmlFor="audit-until" className="text-[11px]">To</Label><Input id="audit-until" type="datetime-local" className="h-8 min-w-0 text-xs" value={until} onChange={(event) => setUntil(event.target.value)} /></div>
        </div>
      </div>
      <div className="bg-card border-border max-w-3xl rounded-xl border p-3.5">
        <AuditTrail key={`${taskId}|${group}|${since}|${until}`} taskId={taskId} group={group} since={since || undefined} until={until || undefined} />
      </div>
    </div>
  );
}

export default function AuditRoute() {
  return <Suspense fallback={<div className="p-6" role="status">Loading audit trail…</div>}><AuditPage /></Suspense>;
}
