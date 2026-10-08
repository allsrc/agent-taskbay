"use client";

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

export function MobileIdentityMenu({ identity }: { identity: { displayName: string; role: string; development: boolean } }) {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok && response.status !== 401) throw new Error();
      window.location.reload();
    } catch {
      setBusy(false);
    }
  }

  const initials = identity.displayName
    .split(" ")
    .map((name) => name[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase() || "U";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`User profile: ${identity.displayName}`}
          className="bg-accent text-accent-foreground flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold transition-opacity hover:opacity-80"
        >
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="p-2">
          <p className="truncate text-xs font-semibold">{identity.displayName}</p>
          <p className="text-muted-foreground font-mono text-[11px]">{identity.development ? "Development identity" : identity.role}</p>
        </div>
        {!identity.development && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void signOut()} disabled={busy} className="cursor-pointer text-xs">
              {busy ? "Signing out…" : "Sign out"}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
