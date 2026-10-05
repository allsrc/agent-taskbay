import type { InboxItem, InboxKind, InboxView } from "@/shared/inbox-types";

export interface InboxFilters { view: InboxView; kind: InboxKind | ""; risk: "" | "low" | "medium" | "high" }

export function inboxQuery(filters: InboxFilters, limit: number, cursor?: string) {
  const params = new URLSearchParams({ view: filters.view, limit: String(limit) });
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.risk) params.set("risk", filters.risk);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

/** Detail route inside the inbox split view; each kind reuses its existing page. */
export const inboxHref = (item: Pick<InboxItem, "kind" | "id">) => `/inbox/${item.kind === "approval" ? "approvals" : "tasks"}/${item.id}`;
