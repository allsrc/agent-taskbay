"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Download, ScrollText } from "lucide-react";
import { AuditTrail } from "@/components/audit/audit-trail";
import { EmptyState } from "@/components/a2a/primitives";
import { Page, PageMessage } from "@/components/console/page";
import { FilterChips } from "@/components/patterns/filter-chips";
import { Panel } from "@/components/patterns/layout";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { auditParams, GROUP_LABEL } from "@/lib/audit";
import { useServerResource } from "@/lib/use-server-resource";
import type { AuditGroup } from "@/shared/audit-types";

const GROUPS = Object.keys(GROUP_LABEL) as AuditGroup[];

/**
 * The audit trail. With a `taskId` it is that task's trail, readable by anyone who can read the task. Without one it is the
 * organization-wide trail, which lives under Administration; an administrator who lands on `/audit` is sent there so the
 * Administration navigation stays around the page.
 */
export function AuditView({ taskId, embedded = false }: { taskId?: string; embedded?: boolean }) {
  const router = useRouter();
  const [group, setGroup] = useState<AuditGroup>("all");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  // The same endpoint answers who may see what: a 403 means this member may only open a single task's trail.
  const probe = useServerResource<{ viewer: { role: string } }>(`/api/audit?${auditParams({ taskId, limit: 1 })}`);
  const admin = probe.data?.viewer.role === "admin";
  useEffect(() => { if (!embedded && !taskId && admin) router.replace("/admin/audit" as Route); }, [embedded, taskId, admin, router]);

  if (probe.loading) return <PageMessage>Loading audit trail…</PageMessage>;
  if (!probe.data) {
    return (
      <EmptyState
        icon={ScrollText}
        title={taskId ? "Task not found" : "Administrators only"}
        action={<Link href="/tasks" className={buttonVariants({ variant: "outline" })}>Back to tasks</Link>}
      >
        {taskId ? "This task is not available to you." : "The organization-wide audit trail is limited to administrators. Open a task to see its own trail."}
      </EmptyState>
    );
  }
  return (
    <Page
      size="default"
      title={taskId ? "Task audit trail" : "Audit trail"}
      description="A permanent, read-only record of who did what and when. Entries cannot be edited or removed. Internal note text is never shown here."
      actions={
        <>
          {taskId && <Link href={`/tasks/${taskId}`} className={buttonVariants({ variant: "outline" })}>Back to task</Link>}
          {admin && <a href={`/api/audit/export?${auditParams({ taskId, group, since, until, limit: 200 })}`} download="audit-trail.csv" className={buttonVariants({ variant: "outline" })}><Download /> Export CSV</a>}
        </>
      }
    >
      <div className="mb-4 space-y-3">
        <FilterChips
          label="Filter the audit trail"
          options={GROUPS.filter((name) => admin || name === "all" || name === "approvals" || name === "ownership").map((name) => ({ value: name, label: GROUP_LABEL[name] }))}
          value={[group]}
          onValueChange={(next) => setGroup((next[0] as AuditGroup | undefined) ?? "all")}
        />
        <div className="grid max-w-md grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="audit-since">From</Label><Input id="audit-since" type="datetime-local" value={since} onChange={(event) => setSince(event.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="audit-until">To</Label><Input id="audit-until" type="datetime-local" value={until} onChange={(event) => setUntil(event.target.value)} /></div>
        </div>
      </div>
      <Panel bodyClassName="p-4">
        <AuditTrail key={`${taskId}|${group}|${since}|${until}`} taskId={taskId} group={group} since={since || undefined} until={until || undefined} />
      </Panel>
    </Page>
  );
}

