"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { SecurityView } from "@/lib/admin-access";

interface AdminData {
  data?: SecurityView;
  error: string;
  busy: boolean;
  /** Send one access change (team, member or grant) and reload. Returns whether it worked. */
  change: (input: Record<string, unknown>) => Promise<boolean>;
}

const AdminContext = createContext<AdminData | null>(null);

async function load(): Promise<SecurityView> {
  const response = await fetch("/api/admin/security", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load organization settings.");
  return response.json();
}

/** Loads the organization's people, teams and grants once for every Admin screen. The layout mounts it for administrators only. */
export function AdminDataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<SecurityView>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void load().then((value) => { if (active) setData(value); }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load organization settings."); });
    return () => { active = false; };
  }, []);

  const change = useCallback(async (input: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/security", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? "Could not update access.");
      setData(await load());
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update access.");
      return false;
    } finally { setBusy(false); }
  }, []);

  const value = useMemo(() => ({ data, error, busy, change }), [data, error, busy, change]);
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdminData(): AdminData {
  const value = useContext(AdminContext);
  if (!value) throw new Error("useAdminData must be used inside the Admin layout.");
  return value;
}
