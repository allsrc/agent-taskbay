"use client";

import { useState } from "react";
export function IdentityMenu({ identity }: { identity: { displayName: string; role: string; development: boolean } }) {
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
  return <div className="border-border mb-2 rounded-lg border p-2 text-sm">
    <p className="truncate font-medium">{identity.displayName}</p>
    <p className="text-muted-foreground text-xs">{identity.development ? "Development identity" : identity.role}</p>
    {!identity.development && <button disabled={busy} onClick={() => void signOut()} className="mt-1 text-xs underline">{busy ? "Signing out…" : "Sign out"}</button>}
    {error && <p role="alert" className="text-destructive text-xs">Sign out failed. Try again.</p>}
  </div>;
}
