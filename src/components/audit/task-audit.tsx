"use client";

import Link from "next/link";
import { InfoCard } from "@/components/a2a/primitives";
import { AuditTrail } from "@/components/audit/audit-trail";

/** The latest entries for one task, with a link to its full trail. Same data and checks as the Audit page. */
export function TaskAudit({ taskId }: { taskId: string }) {
  return (
    <InfoCard label="Audit trail" className="md:col-span-2">
      <AuditTrail taskId={taskId} pageSize={8} compact />
      <Link href={`/audit?taskId=${taskId}`} className="text-primary mt-2 inline-block font-mono text-[12px] hover:underline">View the full trail</Link>
    </InfoCard>
  );
}
