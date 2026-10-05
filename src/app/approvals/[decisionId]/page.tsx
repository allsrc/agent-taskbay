"use client";

import { use, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { BackLink, Chip, EmptyState, InfoCard } from "@/components/a2a/primitives";
import { DecisionStatusChip, RiskChip } from "@/components/approvals/badges";
import { actionLabel, isActionValid, ProposedActionEditor, ProposedActionView } from "@/components/approvals/proposed-action";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IdempotencyKeys, OUTCOME_LABEL, canDecide, executionSummary, expiryLabel, isExpired, isOpen, shortDigest } from "@/lib/approvals";
import { stateName } from "@/lib/task-view";
import { useServerResource } from "@/lib/use-server-resource";
import type { DecisionDetail, DecisionOutcome, ProposedAction, ReviewerOption } from "@/shared/decision-types";
import { cn } from "@/lib/utils";

const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
type Mode = "none" | "edit" | "delegate";

export default function ApprovalReviewPage({ params }: { params: Promise<{ decisionId: string }> }) {
  const { decisionId } = use(params);
  const resource = useServerResource<DecisionDetail>(`/api/decisions/${encodeURIComponent(decisionId)}`);
  const detail = resource.data;

  if (resource.loading) return <div className="p-6" role="status">Loading approval…</div>;
  if (!detail) {
    return (
      <EmptyState icon={<ShieldCheck className="size-7" />} title="Approval not found">
        {resource.error ?? "This approval is not available."} <Link href="/approvals" className="text-primary hover:underline">Back to approvals</Link>
      </EmptyState>
    );
  }
  return <Review key={detail.request.id} detail={detail} refresh={resource.refresh} error={resource.error} />;
}

function Review({ detail, refresh, error }: { detail: DecisionDetail; refresh: () => void; error?: string }) {
  const { request, revisions, decisions, executions, people, viewer } = detail;
  const current = revisions.find((revision) => revision.number === request.currentRevision) ?? revisions.at(-1)!;
  const reviewers = useServerResource<{ reviewers: ReviewerOption[] }>(isOpen(request.status) && !isExpired(request.expiresAt) ? `/api/reviewers?taskId=${encodeURIComponent(request.taskId)}` : null);
  const [rationale, setRationale] = useState("");
  const [mode, setMode] = useState<Mode>("none");
  const [draft, setDraft] = useState<ProposedAction>(current.action);
  const [delegate, setDelegate] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const keys = useRef(new IdempotencyKeys());

  const ownRequest = request.policy.separationOfDuties && request.requesterUserId === viewer.userId;
  const assignedElsewhere = Boolean(request.assignedMembershipId) && request.assignedMembershipId !== viewer.membershipId && viewer.role !== "admin";
  const blocked = ownRequest ? "You requested this approval, so someone else must decide it." :
    assignedElsewhere ? `This approval is assigned to ${people[request.assignedMembershipId!] ?? "another reviewer"}.` : null;
  const decidable = canDecide(request.status, request.expiresAt) && !blocked;
  const expired = isOpen(request.status) && isExpired(request.expiresAt);
  const allowed = (outcome: DecisionOutcome) => request.policy.allowedOutcomes.includes(outcome);
  const reason = rationale.trim().length > 0;
  const changed = JSON.stringify(draft) !== JSON.stringify(current.action);

  async function send(url: string, body: Record<string, unknown>, label: string, idempotent: boolean) {
    setBusy(label); setProblem(null);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json",
        ...(idempotent ? { "Idempotency-Key": keys.current.keyFor(JSON.stringify(body)) } : {}) }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) { keys.current.clear(); throw new Error(result?.error?.message ?? "The request was refused."); }
      keys.current.clear();
      return result;
    } catch (cause) {
      // A thrown network error keeps the key so retrying the identical request replays rather than repeats.
      setProblem(cause instanceof Error ? cause.message : "The request failed.");
      refresh();
      return undefined;
    } finally { setBusy(null); }
  }

  async function decide(outcome: DecisionOutcome) {
    if (outcome === "approve" && !window.confirm("Approve this action? It will be sent to the agent once and cannot be undone.")) return;
    const result = await send(`/api/decisions/${request.id}/decisions`, {
      outcome, rationale: rationale.trim(), expectedRevision: request.currentRevision,
      ...(outcome === "edit" ? { edit: draft } : {}), ...(outcome === "delegate" ? { delegateMembershipId: delegate } : {}) }, outcome, true);
    if (!result) return;
    toast.success(OUTCOME_LABEL[outcome]);
    setRationale(""); setMode("none"); refresh();
  }

  async function revise() {
    const result = await send(`/api/decisions/${request.id}/revisions`, { action: draft, expectedRevision: request.currentRevision }, "revise", false);
    if (!result) return;
    toast.success("Revised proposal submitted"); setMode("none"); refresh();
  }

  const person = (id: string | null | undefined) => (id && people[id]) || "Unknown user";
  const approvedExecution = executions[0];

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
      <BackLink href="/approvals">Approvals</BackLink>
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="min-w-40 flex-1 font-mono text-[22px] font-bold tracking-tight">{request.title}</h2>
        <RiskChip risk={request.risk} />
        <DecisionStatusChip status={request.status} />
      </div>
      <p className="text-muted-foreground mt-1 mb-4 font-mono text-xs">
        {request.agentName ?? "Agent"} · requested by {person(request.requesterUserId)} · {when(request.createdAt)} ·{" "}
        {isOpen(request.status) && <><span className={cn(expired && "text-brand")}>{expiryLabel(request.expiresAt)}</span> · </>}
        <Link href={`/tasks/${request.taskId}`} className="text-primary hover:underline">View task{request.taskState ? ` (${stateName(request.taskState)})` : ""}</Link>
      </p>
      {(error || problem) && <p role="alert" className="text-brand mb-3 text-sm">{problem ?? error}</p>}
      {request.summary && <p className="mb-4 max-w-3xl text-sm whitespace-pre-wrap">{request.summary}</p>}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
        <InfoCard label={`Proposed action · revision ${current.number}`} className="md:col-span-2">
          <p className="text-muted-foreground mb-2 font-mono text-[11px]">{actionLabel(current.action)} · digest {shortDigest(current.digest)}</p>
          <ProposedActionView action={current.action} />
          {isOpen(request.status) && !expired && <p className="text-muted-foreground mt-3 text-[12px]">
            Approving sends exactly this content, once. {request.policy.separationOfDuties && "You cannot approve a request you made."}</p>}
        </InfoCard>

        {decidable && (
          <InfoCard label="Your decision" className="md:col-span-2">
            <Label htmlFor="rationale" className="mb-1.5">Rationale <span className="text-muted-foreground font-normal">(required to reject, edit, delegate or request changes)</span></Label>
            <Textarea id="rationale" value={rationale} rows={2} maxLength={4000} onChange={(event) => setRationale(event.target.value)} disabled={busy !== null} />
            {mode === "edit" && (
              <div className="mt-3">
                <Label htmlFor="edited-action" className="mb-1.5">Edited action</Label>
                <ProposedActionEditor id="edited-action" action={draft} onChange={setDraft} disabled={busy !== null} />
                <div className="mt-2 flex gap-2">
                  <Button variant="brand" disabled={busy !== null || !reason || !changed || !isActionValid(draft) || !allowed("edit")} onClick={() => decide("edit")}>
                    {busy === "edit" && <Loader2 className="animate-spin" />} Approve edited version</Button>
                  <Button variant="outline" onClick={() => { setMode("none"); setDraft(current.action); }}>Cancel edit</Button>
                </div>
                {!changed && <p className="text-muted-foreground mt-1 text-[11px]">Change the text to enable this.</p>}
              </div>
            )}
            {mode === "delegate" && (
              <div className="mt-3">
                <Label htmlFor="delegate" className="mb-1.5">Hand over to</Label>
                <select id="delegate" value={delegate} onChange={(event) => setDelegate(event.target.value)} disabled={busy !== null}
                  className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm">
                  <option value="">Choose a reviewer…</option>
                  {(reviewers.data?.reviewers ?? []).filter((candidate) => !candidate.self).map((candidate) =>
                    <option key={candidate.membershipId} value={candidate.membershipId}>{candidate.displayName} · {candidate.role}</option>)}
                </select>
                <div className="mt-2 flex gap-2">
                  <Button variant="brand" disabled={busy !== null || !reason || !delegate} onClick={() => decide("delegate")}>
                    {busy === "delegate" && <Loader2 className="animate-spin" />} Delegate</Button>
                  <Button variant="outline" onClick={() => setMode("none")}>Cancel</Button>
                </div>
              </div>
            )}
            {mode === "none" && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="brand" disabled={busy !== null || !allowed("approve")} onClick={() => decide("approve")}>
                  {busy === "approve" && <Loader2 className="animate-spin" />} Approve</Button>
                <Button variant="outline" disabled={busy !== null || !allowed("edit")} onClick={() => { setDraft(current.action); setMode("edit"); }}>Edit…</Button>
                <Button variant="outline" disabled={busy !== null || !reason || !allowed("request_changes")} onClick={() => decide("request_changes")}>
                  {busy === "request_changes" && <Loader2 className="animate-spin" />} Request changes</Button>
                <Button variant="outline" disabled={busy !== null || !allowed("delegate")} onClick={() => setMode("delegate")}>Delegate…</Button>
                <Button variant="destructive" disabled={busy !== null || !reason || !allowed("reject")} onClick={() => decide("reject")}>
                  {busy === "reject" && <Loader2 className="animate-spin" />} Reject</Button>
              </div>
            )}
          </InfoCard>
        )}

        {blocked && canDecide(request.status, request.expiresAt) && (
          <InfoCard label="Waiting for a reviewer" className="md:col-span-2"><p className="text-sm" data-testid="blocked-reason">{blocked}</p></InfoCard>
        )}

        {request.status === "changes_requested" && !expired && (
          <InfoCard label="Revise the proposal" className="md:col-span-2">
            <p className="text-muted-foreground mb-2 text-[13px]">A reviewer asked for changes. Submit a revised proposal to put it back in the queue.</p>
            <ProposedActionEditor id="revision" action={draft} onChange={setDraft} disabled={busy !== null} />
            <Button className="mt-2" variant="brand" disabled={busy !== null || !changed || !isActionValid(draft)} onClick={revise}>
              {busy === "revise" && <Loader2 className="animate-spin" />} Submit revised proposal</Button>
          </InfoCard>
        )}

        {expired && (
          <InfoCard label="Expired" className="md:col-span-2">
            <p className="text-sm">This request passed its deadline and can no longer authorize an action. Open a new request from the task if it is still needed.</p>
          </InfoCard>
        )}
        {request.status === "superseded" && (
          <InfoCard label="Superseded" className="md:col-span-2">
            <p className="text-sm">A newer request replaced this one, or the task has finished. It can no longer authorize an action.</p>
          </InfoCard>
        )}

        {approvedExecution && (
          <InfoCard label="Result" className="md:col-span-2">
            <p className="text-sm font-medium" data-testid="execution-summary">{executionSummary(approvedExecution)}</p>
            {approvedExecution.error && <p className="text-brand mt-1 text-[12px]">{approvedExecution.error}</p>}
            <dl className="mt-2 flex flex-col gap-1.5 font-mono text-[11px]">
              {[["Approved revision digest", shortDigest(approvedExecution.revisionDigest)], ["Message ID", approvedExecution.messageId],
                ["Command", approvedExecution.commandId], ["Last checked", when(approvedExecution.updatedAt)]].map(([key, value]) => (
                <div key={key} className="flex justify-between gap-3"><dt className="text-muted-foreground">{key}</dt><dd className="truncate text-right">{value}</dd></div>))}
            </dl>
          </InfoCard>
        )}

        <InfoCard label="Decision record">
          {decisions.length === 0 && <p className="text-muted-foreground text-[13px]">No decision yet.</p>}
          {decisions.map((decision) => {
            const revision = revisions.find((candidate) => candidate.id === decision.revisionId);
            return (
              <div key={decision.id} className="border-border border-t py-2 first:border-t-0">
                <div className="flex items-baseline gap-2"><span className="font-mono text-xs font-bold">{OUTCOME_LABEL[decision.outcome]}</span>
                  <span className="text-muted-foreground ml-auto font-mono text-[11px]">{when(decision.createdAt)}</span></div>
                <p className="text-[12px]">by {person(decision.reviewerUserId)}{decision.delegateMembershipId ? ` → ${person(decision.delegateMembershipId)}` : ""} · revision {revision?.number ?? "?"} ({shortDigest(decision.revisionDigest)})</p>
                {decision.rationale && <p className="mt-0.5 text-[13px] whitespace-pre-wrap">{decision.rationale}</p>}
              </div>
            );
          })}
        </InfoCard>

        <InfoCard label="Revisions">
          {[...revisions].reverse().map((revision) => (
            <div key={revision.id} className="border-border border-t py-2 first:border-t-0">
              <div className="flex items-center gap-2"><Chip>#{revision.number}</Chip>
                {revision.id === current.id && <span className="text-primary font-mono text-[11px]">current</span>}
                <span className="text-muted-foreground ml-auto font-mono text-[11px]">{person(revision.authorUserId)} · {when(revision.createdAt)}</span></div>
              <p className="mt-1 line-clamp-3 text-[13px] whitespace-pre-wrap">{revision.action.text}</p>
            </div>
          ))}
        </InfoCard>
      </div>
    </div>
  );
}
