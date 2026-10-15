"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/patterns/status";
import type { ExtendedCardView } from "@/lib/extended-card";

export function ExtendedCardStatus({ advertised, admin, card, busy, unavailable, failed, onFetch }: {
  advertised: boolean; admin: boolean; card?: ExtendedCardView; busy: boolean; unavailable: boolean; failed: boolean; onFetch: () => void;
}) {
  return <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
    <span>Extended card</span>
    <div className="flex flex-wrap items-center gap-2" aria-live="polite">
      {failed ? <Pill tone="danger">Fetch failed</Pill> : unavailable ? <span>Not configured on this agent</span> :
        card ? <span className="text-muted-foreground">Fetched <time dateTime={card.fetchedAt}>{new Date(card.fetchedAt).toLocaleString()}</time></span> :
          <Pill tone="neutral">{advertised ? "Available" : "Not advertised"}</Pill>}
      {admin && advertised && <Button size="sm" variant="outline" onClick={onFetch} disabled={busy}>
        {busy ? "Fetching…" : failed ? "Retry" : card ? "Refresh" : "Fetch"}
      </Button>}
    </div>
  </li>;
}

export function ExtendedCardRow({ agentId, advertised, admin, card, onChanged }: {
  agentId: string; advertised: boolean; admin: boolean; card?: ExtendedCardView; onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<"ready" | "unavailable" | "failed">("ready");
  async function load() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/agents/${agentId}/extended-card/refresh`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error("Fetch failed");
      setOutcome(body.available === false ? "unavailable" : "ready");
      if (body.available !== false) await onChanged();
    } catch { setOutcome("failed"); }
    finally { setBusy(false); }
  }
  return <ExtendedCardStatus advertised={advertised} admin={admin} card={card} busy={busy}
    unavailable={outcome === "unavailable"} failed={outcome === "failed"} onFetch={() => void load()} />;
}
