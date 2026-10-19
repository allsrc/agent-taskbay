"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuditView } from "@/components/audit/audit-view";
import { PageMessage } from "@/components/console/page";

export default function AuditRoute() {
  return <Suspense fallback={<PageMessage>Loading audit trail…</PageMessage>}><AuditRouteBody /></Suspense>;
}

function AuditRouteBody() {
  return <AuditView taskId={useSearchParams().get("taskId") ?? undefined} />;
}
