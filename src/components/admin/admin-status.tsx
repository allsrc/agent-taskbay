"use client";

import { PageMessage } from "@/components/console/page";
import type { SecurityView } from "@/lib/admin-access";
import { useAdminData } from "./admin-data";

/** Renders `children` once the organization data has loaded; otherwise the loading or error message. */
export function WhenLoaded({ children }: { children: (view: SecurityView) => React.ReactNode }) {
  const { data, error } = useAdminData();
  if (data) return <>{children(data)}</>;
  return error ? <PageMessage role="alert">{error}</PageMessage> : <PageMessage>Loading…</PageMessage>;
}

export function ErrorLine() {
  const { error, data } = useAdminData();
  return error && data ? <p role="alert" className="text-danger mb-3 text-sm">{error}</p> : null;
}
