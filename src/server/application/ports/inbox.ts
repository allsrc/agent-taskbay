import type { InboxKind, InboxView } from "../../../shared/inbox-types";

export interface InboxQuery {
  organizationId: string;
  /** The caller's membership, for the "assigned" view. */
  membershipId: string;
  now: Date;
  view: InboxView;
  kind?: InboxKind;
  agentId?: string;
  skillId?: string;
  risk?: "low" | "medium" | "high";
  /** Narrows to one task state or approval status; the other kind is excluded when it cannot match. */
  status?: string;
  updatedAfter?: Date;
  /** Keyset position: rows strictly after this (updatedAt, id) in newest-first order. */
  after?: { updatedAt: Date; id: string };
  limit: number;
  /** Agent/skill read grants; `undefined` means the caller may read everything in the organization. */
  scope?: Array<{ agentId: string; skillId: string | null }>;
}

export interface InboxRow {
  kind: InboxKind; id: string; taskId: string; agentId: string; skillId: string | null; status: string; title: string | null;
  risk: "low" | "medium" | "high" | null; assigneeMembershipId: string | null; dueAt: Date | null; expiresAt: Date | null;
  escalationLevel: number; updatedAt: Date;
}

export interface InboxRepository {
  /** Newest-first rows across tasks and approval requests, from typed indexed columns only. */
  page(query: InboxQuery): Promise<InboxRow[]>;
}
