"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { InfoCard } from "@/components/a2a/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { assigneeLabel, canManage, canOperate, dueLabel, eventSummary, fromLocalInput, isOverdue, toLocalInput } from "@/lib/workflow";
import { relativeTime } from "@/lib/task-view";
import { useServerResource } from "@/lib/use-server-resource";
import type { ReviewerOption } from "@/shared/decision-types";
import type { WorkflowDetail } from "@/shared/workflow-types";
import { cn } from "@/lib/utils";

const select = "border-input bg-background h-9 min-w-0 flex-1 rounded-md border px-2 text-sm";

/** Ownership, due time and activity for one task. Hidden controls never replace the server's checks. */
export function TaskOwnership({ taskId, active }: { taskId: string; active: boolean }) {
  const resource = useServerResource<WorkflowDetail>(`/api/tasks/${encodeURIComponent(taskId)}/workflow`);
  const data = resource.data;
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState<string | null>(null);
  const operator = data ? canOperate(data.viewer.role) : false;
  const manage = data ? operator && active && canManage(data.viewer, data.assignment) : false;
  const reviewers = useServerResource<{ reviewers: ReviewerOption[] }>(manage ? `/api/reviewers?taskId=${encodeURIComponent(taskId)}` : null);

  async function post(path: string, body: unknown, label: string, success: string) {
    setBusy(label); setProblem(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/workflow/${path}`, { method: "POST",
        headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message ?? "The change was refused.");
      toast.success(success); setDue(null); setAssignee("");
    } catch (cause) { setProblem(cause instanceof Error ? cause.message : "The change failed."); }
    finally { setBusy(null); resource.refresh(); }
  }

  if (!data) return <InfoCard label="Ownership">{resource.error ? <p role="alert" className="text-brand text-[13px]">{resource.error}</p> : <p role="status" className="text-muted-foreground text-[13px]">Loading…</p>}</InfoCard>;
  const { assignment, viewer, people } = data;
  const overdue = active && isOverdue(assignment?.dueAt);
  const dueValue = due ?? toLocalInput(assignment?.dueAt ?? null);
  const mine = assignment?.assigneeMembershipId === viewer.membershipId;

  return (
    <InfoCard label="Ownership" className="md:col-span-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold" data-testid="assignee">{assigneeLabel(assignment, viewer.membershipId, people)}</span>
        {assignment?.dueAt && <span className={cn("rounded-full px-2 py-0.5 font-mono text-[10px] font-medium", overdue ? "text-brand bg-brand/15" : "text-muted-foreground bg-muted-foreground/15")} data-testid="due">
          {active ? dueLabel(assignment.dueAt) : `Was due ${new Date(assignment.dueAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`}</span>}
        {assignment && assignment.escalationLevel > 0 && <span className="text-auth bg-auth/15 rounded-full px-2 py-0.5 font-mono text-[10px] font-medium" data-testid="escalated">
          ESCALATED{assignment.escalationLevel > 1 ? ` ×${assignment.escalationLevel}` : ""}</span>}
      </div>
      {problem && <p role="alert" className="text-brand mt-2 text-[13px]">{problem}</p>}
      {!active && <p className="text-muted-foreground mt-2 text-[12px]">This task has finished, so ownership can no longer change.</p>}
      {operator && active && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {!assignment?.assigneeMembershipId && <Button size="sm" variant="brand" disabled={busy !== null} onClick={() => post("claim", undefined, "claim", "You own this task")}>
              {busy === "claim" && <Loader2 className="animate-spin" />} Claim</Button>}
            {assignment?.assigneeMembershipId && manage && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => post("release", undefined, "release", "Task released")}>
              {busy === "release" && <Loader2 className="animate-spin" />} {mine ? "Release" : "Take away"}</Button>}
            {assignment?.assigneeMembershipId && !manage && <span className="text-muted-foreground text-[12px]">Only the owner or an administrator can change this.</span>}
          </div>
          {manage && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="assign-to">Assign task to</label>
              <select id="assign-to" className={select} value={assignee} disabled={busy !== null} onChange={(event) => setAssignee(event.target.value)}>
                <option value="">Assign to…</option>
                {(reviewers.data?.reviewers ?? []).filter((candidate) => candidate.membershipId !== assignment?.assigneeMembershipId)
                  .map((candidate) => <option key={candidate.membershipId} value={candidate.membershipId}>{candidate.displayName}{candidate.self ? " (you)" : ""} · {candidate.role}</option>)}
              </select>
              <Button size="sm" variant="outline" disabled={busy !== null || !assignee} onClick={() => post("assign", { assigneeMembershipId: assignee }, "assign", "Task assigned")}>
                {busy === "assign" && <Loader2 className="animate-spin" />} Assign</Button>
            </div>
          )}
          {manage && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="due-at">Due time</label>
              <Input id="due-at" type="datetime-local" className="h-9 min-w-0 flex-1" value={dueValue} disabled={busy !== null} onChange={(event) => setDue(event.target.value)} />
              <Button size="sm" variant="outline" disabled={busy !== null || !dueValue || dueValue === toLocalInput(assignment?.dueAt ?? null)}
                onClick={() => post("due", { dueAt: fromLocalInput(dueValue) }, "due", "Due time saved")}>{busy === "due" && <Loader2 className="animate-spin" />} Set due</Button>
              {assignment?.dueAt && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => post("due", { dueAt: null }, "due", "Due time cleared")}>Clear</Button>}
            </div>
          )}
        </div>
      )}
      {data.events.length > 0 && (
        <ul className="border-border mt-3 border-t pt-2" aria-label="Ownership activity">
          {data.events.slice(0, 8).map((event) => (
            <li key={event.id} className="flex items-baseline gap-2 py-1 text-[12px]">
              <span className="min-w-0 flex-1">{eventSummary(event, people, viewer.membershipId)}</span>
              <span className="text-muted-foreground font-mono text-[11px]">{relativeTime(event.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </InfoCard>
  );
}

/** Internal notes: shared between reviewers, never sent to the agent. */
export function TaskNotes({ taskId }: { taskId: string }) {
  const resource = useServerResource<WorkflowDetail>(`/api/tasks/${encodeURIComponent(taskId)}/workflow`);
  const data = resource.data;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // One key per draft, so a retried submit after a lost response returns the same note rather than a duplicate.
  const noteKey = useRef(crypto.randomUUID());
  if (!data) return <InfoCard label="Internal notes" className="md:col-span-2"><p className="text-muted-foreground text-[13px]">{resource.error ?? "Loading…"}</p></InfoCard>;

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true); setProblem(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/workflow/notes`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, noteKey: noteKey.current }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message ?? "The note could not be saved.");
      setText(""); noteKey.current = crypto.randomUUID(); resource.refresh();
    } catch (cause) { setProblem(cause instanceof Error ? cause.message : "The note could not be saved."); }
    finally { setBusy(false); }
  }

  return (
    <InfoCard label="Internal notes" className="md:col-span-2">
      <p className="text-muted-foreground mb-2 text-[12px]">Visible to your team only. Notes are never sent to the agent and cannot be edited or removed.</p>
      {canOperate(data.viewer.role) && (
        <form onSubmit={add} className="mb-3 flex flex-col gap-2">
          <Textarea aria-label="Add a note" value={text} rows={2} maxLength={4000} placeholder="Add context for whoever picks this up next…" disabled={busy} onChange={(event) => setText(event.target.value)} />
          {problem && <p role="alert" className="text-brand text-[13px]">{problem}</p>}
          <div><Button type="submit" size="sm" variant="outline" disabled={busy || !text.trim()}>{busy && <Loader2 className="animate-spin" />} Add note</Button></div>
        </form>
      )}
      {data.notes.length === 0 && <p className="text-muted-foreground text-[13px]">No notes yet.</p>}
      <ul aria-label="Internal notes">
        {data.notes.map((note) => (
          <li key={note.id} className="border-border border-t py-2 first:border-t-0">
            <div className="flex items-baseline gap-2"><span className="font-mono text-[11px] font-medium">{data.people[note.authorUserId] ?? "Unknown user"}</span>
              <span className="text-muted-foreground ml-auto font-mono text-[11px]">{relativeTime(note.createdAt)}</span></div>
            <p className="text-[13px] break-words whitespace-pre-wrap">{note.body}</p>
          </li>
        ))}
      </ul>
    </InfoCard>
  );
}
