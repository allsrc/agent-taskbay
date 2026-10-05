"use client";
import { useCallback, useEffect, useState } from "react";
import { InfoCard } from "./a2a/primitives";
import { Button } from "./ui/button";
import type { ChannelStatus } from "@/shared/notification-types";

async function loadStatus(): Promise<ChannelStatus | undefined> {
  const response = await fetch("/api/notifications/channel", { cache: "no-store" });
  if (response.status === 403) return;
  if (!response.ok) throw new Error("Could not load the notification channel.");
  return response.json();
}

/** Administrator-only: the external channel's state. The URL and secret live in server configuration and are never shown. */
export function NotificationChannelSettings() {
  const [status, setStatus] = useState<ChannelStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const apply = useCallback((value: ChannelStatus | undefined) => { if (value) setStatus(value); }, []);
  useEffect(() => {
    let active = true;
    void loadStatus().then((value) => { if (active) apply(value); }).catch(() => { if (active) setError("Could not load the notification channel."); });
    const timer = setInterval(() => { void loadStatus().then((value) => { if (active) apply(value); }).catch(() => undefined); }, 10_000);
    return () => { active = false; clearInterval(timer); };
  }, [apply]);

  async function test() {
    setBusy(true); setError(""); setSent(false);
    try {
      const response = await fetch("/api/notifications/test", { method: "POST" });
      if (!response.ok) throw new Error((await response.json()).error?.message ?? "Could not send the test.");
      setSent(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not send the test."); }
    finally { setBusy(false); }
  }
  if (!status) return error ? <p role="alert">{error}</p> : null;
  return (
    <InfoCard label="Notification channel">
      <p className="text-muted-foreground mb-2 text-xs">Everyone receives notifications in the app. An optional signed webhook (for example a team chat) also receives each one; its address and secret are set in server configuration.</p>
      {error && <p role="alert" className="text-destructive mb-2 text-[13px]">{error}</p>}
      <dl className="flex flex-col gap-1.5 font-mono text-[12px]">
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Webhook</dt>
          <dd data-testid="channel-state">{!status.configured ? "Not configured" : status.enabledForOrganization ? `On → ${status.host}` : "Configured for another organization"}</dd></div>
        {status.configured && (<>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Delivered</dt><dd>{status.counts.delivered}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Waiting / retrying</dt><dd>{status.counts.pending + status.counts.processing}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Gave up</dt><dd className={status.counts.failed ? "text-brand" : undefined}>{status.counts.failed}</dd></div>
        </>)}
      </dl>
      {status.lastFailure && <p className="text-brand mt-2 text-[12px]">Last failure: {status.lastFailure.message ?? "Delivery failed."}</p>}
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={test}>Send test notification</Button>
        {sent && <span role="status" className="text-success text-[12px]">Queued — it will appear in your notifications.</span>}
      </div>
    </InfoCard>
  );
}
