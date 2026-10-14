"use client";

import Link from "next/link";
import { InfoCard } from "@/components/a2a/primitives";
import { AuditTrail } from "@/components/audit/audit-trail";
import { buttonVariants } from "@/components/ui/button";

/** The latest entries for one task, with a link to its full trail. Same data and checks as the Audit page. */
export function TaskAudit({ taskId }: { taskId: string }) {
  return (
    <InfoCard label="Audit trail">
      <AuditTrail taskId={taskId} pageSize={8} compact />
      <Link href={`/audit?taskId=${taskId}`} className={buttonVariants({ variant: "outline", size: "sm", className: "mt-3" })}>View the full trail</Link>
    </InfoCard>
  );
}
