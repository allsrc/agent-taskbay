"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { CommandError } from "@/components/a2a/command-error";
import { BrowseTaskRow } from "@/components/agents/browse-task-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { BROWSE_STATUS_OPTIONS, browseUrl, type BrowseRowView } from "@/lib/browse-tasks";
import { failureFromError, failureFromResponse, CommandFailureError, type CommandFailure } from "@/lib/command-failure";

interface Page { rows: BrowseRowView[]; nextPageToken: string; dropped: number }

/**
 * The agent's tasks right now, read live with the agent's own credential. Nothing is stored until a person chooses Track.
 * Results are never kept between visits, and pages are the agent's own, followed by its token.
 */
export function BrowseTasksPanel({ agentId, tenants = [] }: {
  agentId: string;
  /** Tenants the agent's card declares; a selector appears when there is more than one. */
  tenants?: string[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [contextId, setContextId] = useState("");
  const [tenant, setTenant] = useState(tenants[0] ?? "");
  const [tokens, setTokens] = useState<string[]>([""]);
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<CommandFailure | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowFailures, setRowFailures] = useState<Record<string, CommandFailure>>({});
  const [byId, setById] = useState("");
  const [byIdBusy, setByIdBusy] = useState(false);
  const [byIdFailure, setByIdFailure] = useState<CommandFailure | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const request = useRef(0);
  const token = tokens.at(-1) ?? "";

  const load = useCallback(async () => {
    const mine = ++request.current;
    setLoading(true);
    setFailure(null);
    try {
      const response = await fetch(browseUrl(agentId, { tenant, contextId: contextId.trim(), status, pageToken: token }), { cache: "no-store" });
      if (!response.ok) { const refusal = await failureFromResponse(response, "Could not load the agent's tasks."); throw new CommandFailureError(refusal.message, refusal); }
      const body = (await response.json()) as Page;
      if (mine === request.current) { setPage(body); setLoadedAt(Date.now()); }
    } catch (error) {
      if (mine === request.current) { setPage(null); setFailure(failureFromError(error, "Could not load the agent's tasks.")); }
    } finally {
      if (mine === request.current) setLoading(false);
    }
  }, [agentId, tenant, contextId, status, token]);

  useEffect(() => { void load(); }, [load]);

  async function track(taskId: string) {
    setBusy(taskId);
    setRowFailures((current) => { const next = { ...current }; delete next[taskId]; return next; });
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/remote-tasks/track`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId, tenant }) });
      if (!response.ok) { const refusal = await failureFromResponse(response, "Could not track the task."); throw new CommandFailureError(refusal.message, refusal); }
      const { localId } = (await response.json()) as { localId: string };
      setPage((current) => current && { ...current, rows: current.rows.map((row) => row.taskId === taskId ? { ...row, tracked: true, localId } : row) });
      return localId;
    } catch (error) {
      setRowFailures((current) => ({ ...current, [taskId]: failureFromError(error, "Could not track the task.") }));
      return undefined;
    } finally { setBusy(null); }
  }

  async function trackById() {
    const taskId = byId.trim();
    if (!taskId) return;
    setByIdBusy(true);
    setByIdFailure(null);
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/remote-tasks/track`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId, tenant }) });
      if (!response.ok) { const refusal = await failureFromResponse(response, "Could not track the task."); throw new CommandFailureError(refusal.message, refusal); }
      const { localId } = (await response.json()) as { localId: string };
      router.push(`/tasks/${localId}`);
    } catch (error) { setByIdFailure(failureFromError(error, "Could not track the task.")); }
    finally { setByIdBusy(false); }
  }

  const changeFilter = (apply: () => void) => { apply(); setTokens([""]); };

  return (
    <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-36 space-y-1 text-xs">
            <span className="text-muted-foreground">State</span>
            <NativeSelect value={status} onChange={(event) => changeFilter(() => setStatus(event.target.value))} aria-label="State">
              {BROWSE_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </NativeSelect>
          </label>
          <label className="min-w-40 flex-1 space-y-1 text-xs">
            <span className="text-muted-foreground">Context ID</span>
            <Input value={contextId} onChange={(event) => changeFilter(() => setContextId(event.target.value))} placeholder="Paste a context ID" maxLength={255} aria-label="Context ID" />
          </label>
          {tenants.length > 1 && (
            <label className="min-w-32 space-y-1 text-xs">
              <span className="text-muted-foreground">Tenant</span>
              <NativeSelect value={tenant} onChange={(event) => changeFilter(() => setTenant(event.target.value))} aria-label="Tenant">
                {tenants.map((value) => <option key={value} value={value}>{value || "(default)"}</option>)}
              </NativeSelect>
            </label>
          )}
        </div>

        {failure && <CommandError failure={failure} onRetry={() => void load()} />}
        {loading && !page && <p className="text-muted-foreground flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> Loading tasks…</p>}
        {page && page.rows.length === 0 && <p className="text-muted-foreground text-sm">The agent returned no tasks for this filter.</p>}
        {page && page.rows.length > 0 && (
          <ul className="divide-y rounded-xl border bg-card px-4" aria-busy={loading}>
            {page.rows.map((row) => <BrowseTaskRow key={row.taskId} row={row} busy={busy === row.taskId} failure={rowFailures[row.taskId]} now={loadedAt} onTrack={() => void track(row.taskId)} />)}
          </ul>
        )}
        {page && page.dropped > 0 && <p className="text-muted-foreground text-xs">{page.dropped} {page.dropped === 1 ? "entry" : "entries"} from the agent could not be read and {page.dropped === 1 ? "is" : "are"} not shown.</p>}
        {page && (tokens.length > 1 || page.nextPageToken) && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={tokens.length < 2 || loading} onClick={() => setTokens((current) => current.slice(0, -1))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={!page.nextPageToken || loading} onClick={() => setTokens((current) => [...current, page.nextPageToken])}>Next</Button>
          </div>
        )}

        <form className="space-y-2 border-t pt-3" onSubmit={(event) => { event.preventDefault(); void trackById(); }}>
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">Know the task ID? Track it directly.</span>
            <div className="flex gap-2">
              <Input value={byId} onChange={(event) => setById(event.target.value)} placeholder="Task ID" maxLength={255} aria-label="Task ID" />
              <Button type="submit" variant="outline" disabled={!byId.trim() || byIdBusy}>{byIdBusy && <Loader2 className="animate-spin" />} Track by task ID</Button>
            </div>
          </label>
          {byIdFailure && <CommandError failure={byIdFailure} />}
        </form>
    </div>
  );
}
