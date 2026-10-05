"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { InfoCard } from "@/components/a2a/primitives";
import { DecisionStatusChip } from "@/components/approvals/badges";
import { RequestApprovalDialog } from "@/components/approvals/request-approval-dialog";
import { Button } from "@/components/ui/button";
import { expiryLabel, isOpen } from "@/lib/approvals";
import { relativeTime } from "@/lib/task-view";
import { useServerResource } from "@/lib/use-server-resource";
import type { DecisionRequestView } from "@/shared/decision-types";

/** Approvals recorded for one task, with the entry point to ask for a new one. Hidden controls never replace server checks. */
export function TaskApprovals({ taskId, canRequest }: { taskId: string; canRequest: boolean }) {
  const resource = useServerResource<{ decisions: DecisionRequestView[] }>(`/api/decisions?taskId=${encodeURIComponent(taskId)}`);
  const [open, setOpen] = useState(false);
  const rows = resource.data?.decisions ?? [];
  return (
    <InfoCard label="Approvals">
      {rows.map((request) => (
        <Link key={request.id} href={`/approvals/${request.id}`} className="hover:bg-accent/50 -mx-1 flex items-center gap-2 rounded-md px-1 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{request.title}</span>
          <span className="text-muted-foreground font-mono text-[11px]">{isOpen(request.status) ? expiryLabel(request.expiresAt) : relativeTime(request.updatedAt)}</span>
          <DecisionStatusChip status={request.status} />
        </Link>
      ))}
      {!resource.loading && rows.length === 0 && <p className="text-muted-foreground pb-1 text-[13px]">No approvals for this task.</p>}
      {resource.error && <p role="alert" className="text-brand text-[12px]">{resource.error}</p>}
      {canRequest && (
        <>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => setOpen(true)}><ShieldCheck /> Request approval</Button>
          {open && <RequestApprovalDialog taskId={taskId} open onOpenChange={setOpen} onCreated={resource.refresh} />}
        </>
      )}
    </InfoCard>
  );
}
