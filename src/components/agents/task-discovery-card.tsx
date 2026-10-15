"use client";

import { useState } from "react";
import { ListChecks } from "lucide-react";
import { InfoCard } from "@/components/a2a/primitives";
import { Callout } from "@/components/patterns/data-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AUTOMATIC_DISCOVERY_AVAILABLE, DISCOVERY_MODES, modeAllowedByCap, type DiscoveryModeValue, type DiscoveryStatusView } from "@/lib/browse-tasks";
import { relativeTime } from "@/lib/task-view";

/** What the card shows. Static, so every state can be checked without a browser; the container below supplies the data and the actions. */
export function TaskDiscoveryView({ status, admin, saving, error, onChange, onHistoryChange, onBrowse, now }: {
  status: DiscoveryStatusView;
  admin: boolean;
  saving?: boolean;
  error?: string | null;
  onChange?: (mode: DiscoveryModeValue) => void;
  onHistoryChange?: (days: number) => void;
  onBrowse?: () => void;
  /** The time the status was read, so ages stay stable while it is shown. */
  now: number;
}) {
  const modes = DISCOVERY_MODES.filter((mode) => mode.value !== "auto" || AUTOMATIC_DISCOVERY_AVAILABLE || status.mode === "auto");
  return (
    <InfoCard label="Task discovery" action={status.canBrowse && onBrowse ? <Button size="sm" variant="outline" onClick={onBrowse}><ListChecks /> Browse tasks</Button> : undefined}>
      <RadioGroup value={status.mode} onValueChange={(value) => onChange?.(value as DiscoveryModeValue)} disabled={!admin || saving} aria-label="Task discovery mode">
        {modes.map((mode) => {
          const capped = !modeAllowedByCap(mode.value, status.cap);
          return (
            <label key={mode.value} className="flex items-start gap-2.5 text-sm">
              <RadioGroupItem value={mode.value} disabled={!admin || saving || capped} aria-label={mode.label} className="mt-0.5" />
              <span className="space-y-0.5">
                <span className="block font-medium">{mode.label}</span>
                <span className="text-muted-foreground block leading-relaxed">{mode.help}</span>
                {capped && <span className="text-muted-foreground block">This deployment allows up to {status.cap}.</span>}
              </span>
            </label>
          );
        })}
      </RadioGroup>
      {!admin && <p className="text-muted-foreground mt-3 text-xs">Only administrators can change this.</p>}
      {status.effectiveMode !== status.mode && <p className="text-muted-foreground mt-3 text-xs">This deployment limits discovery to “{status.cap}”, so “{status.effectiveMode}” applies.</p>}
      {status.mode === "auto" && (
        <label className="text-muted-foreground mt-3 flex items-center gap-2 text-sm">
          <span>Include finished tasks from the last</span>
          <Input type="number" min={0} max={90} step={1} defaultValue={status.historyDays} disabled={!admin || saving} className="w-20"
            aria-label="Days of finished tasks to include" onBlur={(event) => { const days = Number(event.target.value); if (Number.isInteger(days) && days >= 0 && days <= 90 && days !== status.historyDays) onHistoryChange?.(days); }} />
          <span>days</span>
        </label>
      )}
      {status.listing === "unsupported" && <p className="text-muted-foreground mt-3 text-sm">This agent does not support listing tasks, so browsing and automatic discovery cannot find anything.</p>}
      {status.auto && (
        <p className="text-muted-foreground mt-3 text-sm">
          {status.auto.lastCheckedAt ? `Checked ${relativeTime(status.auto.lastCheckedAt, now)} ago · ${status.auto.foundTotal} found` : "Not checked yet"}
        </p>
      )}
      {status.pausedReason && <Callout tone="warning" className="mt-3">{status.pausedReason}</Callout>}
      {error && <p role="alert" className="text-danger mt-3 text-sm">{error}</p>}
    </InfoCard>
  );
}

export function TaskDiscoveryCard({ agentId, status, admin, onChanged, onBrowse }: {
  agentId: string;
  status: DiscoveryStatusView;
  admin: boolean;
  onChanged: () => void | Promise<void>;
  onBrowse: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const [pending, setPending] = useState<DiscoveryModeValue | null>(null);

  async function change(mode?: DiscoveryModeValue, historyDays?: number) {
    setSaving(true);
    setError(null);
    setPending(mode ?? null);
    try {
      const response = await fetch(`/api/agents/${agentId}/settings`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(mode ? { taskDiscovery: mode } : {}), ...(historyDays !== undefined ? { taskDiscoveryHistoryDays: historyDays } : {}) }) });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? "Could not change task discovery.");
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change task discovery.");
    } finally {
      setSaving(false);
      setPending(null);
    }
  }
  // Show the choice at once; it is put back if saving fails.
  return <TaskDiscoveryView status={pending && !error ? { ...status, mode: pending } : status} admin={admin} saving={saving} error={error} onChange={(mode) => void change(mode)} onHistoryChange={(days) => void change(undefined, days)} onBrowse={onBrowse} now={now} />;
}
