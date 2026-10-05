"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useServerResource } from "@/lib/use-server-resource";
import type { DecisionRisk, ReviewerOption } from "@/shared/decision-types";

const LIFETIMES = [{ label: "1 hour", hours: 1 }, { label: "8 hours", hours: 8 }, { label: "24 hours", hours: 24 }, { label: "7 days", hours: 168 }];
const select = "border-input bg-background h-9 w-full rounded-md border px-2 text-sm";

/**
 * Agents cannot open approvals themselves yet, so an operator records the action an agent wants approved.
 * Mounted only while open so each open starts clean.
 */
export function RequestApprovalDialog({ taskId, open, onOpenChange, onCreated }: { taskId: string; open: boolean;
  onOpenChange: (open: boolean) => void; onCreated?: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border max-md:top-auto max-md:bottom-0 max-md:translate-y-0 max-md:rounded-b-none max-md:rounded-t-2xl sm:max-w-[480px]">
        <RequestForm taskId={taskId} onDone={() => onOpenChange(false)} onCreated={onCreated} />
      </DialogContent>
    </Dialog>
  );
}

function RequestForm({ taskId, onDone, onCreated }: { taskId: string; onDone: () => void; onCreated?: () => void }) {
  const router = useRouter();
  const reviewers = useServerResource<{ reviewers: ReviewerOption[] }>(`/api/reviewers?taskId=${encodeURIComponent(taskId)}`);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [text, setText] = useState("");
  const [risk, setRisk] = useState<DecisionRisk>("medium");
  const [hours, setHours] = useState(24);
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per form, so a retried submit after a lost response returns the same request.
  const requestKey = useRef(crypto.randomUUID());
  const valid = title.trim().length > 0 && text.trim().length > 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/decisions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        taskId, requestKey: requestKey.current, title: title.trim(), summary: summary.trim(), risk,
        action: { kind: "send_message", text }, expiresAt: new Date(Date.now() + hours * 3_600_000).toISOString(),
        ...(assignee ? { assignedMembershipId: assignee } : {}) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not open the approval request.");
      toast.success("Approval requested");
      onCreated?.(); onDone();
      router.push(`/approvals/${body.decision.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the approval request.");
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <DialogTitle className="font-mono text-base font-bold">Request approval</DialogTitle>
      <DialogDescription className="text-muted-foreground text-[13px]">
        Record an action for a reviewer to approve before it is sent to the agent. Nothing is sent until someone approves it.
      </DialogDescription>
      <div className="flex flex-col gap-1.5"><Label htmlFor="ra-title">What needs approval</Label>
        <Input id="ra-title" value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} placeholder="Delete the staging cluster" autoFocus /></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="ra-summary">Context for the reviewer</Label>
        <Textarea id="ra-summary" value={summary} maxLength={4000} rows={2} onChange={(event) => setSummary(event.target.value)} /></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="ra-text">Message to send if approved</Label>
        <Textarea id="ra-text" value={text} maxLength={20000} rows={4} onChange={(event) => setText(event.target.value)} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5"><Label htmlFor="ra-risk">Risk</Label>
          <select id="ra-risk" className={select} value={risk} onChange={(event) => setRisk(event.target.value as DecisionRisk)}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="ra-expiry">Expires after</Label>
          <select id="ra-expiry" className={select} value={hours} onChange={(event) => setHours(Number(event.target.value))}>
            {LIFETIMES.map((option) => <option key={option.hours} value={option.hours}>{option.label}</option>)}</select></div>
      </div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="ra-assignee">Assign to</Label>
        <select id="ra-assignee" className={select} value={assignee} onChange={(event) => setAssignee(event.target.value)}>
          <option value="">Anyone with access</option>
          {(reviewers.data?.reviewers ?? []).map((reviewer) => <option key={reviewer.membershipId} value={reviewer.membershipId}>
            {reviewer.displayName}{reviewer.self ? " (you)" : ""} · {reviewer.role}</option>)}
        </select>
        <p className="text-muted-foreground text-[11px]">By default the requester cannot approve their own request.</p></div>
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="brand" disabled={!valid || busy}>{busy && <Loader2 className="animate-spin" />} Request approval</Button>
      </div>
    </form>
  );
}
