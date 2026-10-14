"use client";

import { useState } from "react";
import { LogOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function IdentityMenu({ identity, compact = false }: { identity: { displayName: string; role: string; development: boolean }; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function signOut() {
    setBusy(true); setError(false);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok && response.status !== 401) throw new Error();
      // Full reload disposes every user-scoped in-memory projection cache.
      window.location.reload();
    } catch { setError(true); setBusy(false); }
  }
  if (compact) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <span className="bg-brand-soft text-brand-text flex size-8 items-center justify-center rounded-full font-mono text-xs font-semibold uppercase" title={`${identity.displayName} · ${identity.development ? "Development identity" : identity.role}`}>
          {identity.displayName.slice(0, 2)}
        </span>
        {!identity.development && (
          <Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => void signOut()} aria-label="Sign out" title="Sign out"><LogOutIcon /></Button>
        )}
        {error && <p role="alert" className="text-danger text-[10px]">Sign out failed</p>}
      </div>
    );
  }
  return (
    <div className="bg-card flex items-center gap-2 rounded-lg border p-2.5 text-sm">
      <span className="bg-brand-soft text-brand-text flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold uppercase" aria-hidden>
        {identity.displayName.slice(0, 2)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{identity.displayName}</p>
        <p className="text-muted-foreground truncate text-xs">{identity.development ? "Development identity" : identity.role}</p>
        {error && <p role="alert" className="text-danger text-xs">Sign out failed. Try again.</p>}
      </div>
      {!identity.development && (
        <Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => void signOut()} aria-label={busy ? "Signing out…" : "Sign out"} title="Sign out">
          <LogOutIcon />
        </Button>
      )}
    </div>
  );
}
