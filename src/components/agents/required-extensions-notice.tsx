"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Callout } from "@/components/patterns/data-display";
import { Switch } from "@/components/ui/switch";

/**
 * An Agent Card can require an extension Taskbay does not support. Sending is then blocked; an administrator can allow it, and that is audited.
 * The extension URIs come from the agent and are shown only as text.
 */
export function RequiredExtensionsNotice({ agentId, unsupported, override, admin, onChanged }: {
  agentId: string;
  unsupported: string[];
  override: boolean;
  admin: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!unsupported.length) return null;

  async function change(next: boolean) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/agents/${agentId}/settings`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ extensionOverride: next }) });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? "Could not change the setting.");
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the setting.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Callout
      tone={override ? "warning" : "danger"}
      icon={ShieldAlert}
      title="This agent requires an extension Taskbay does not support"
      action={admin ? (
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={override} disabled={saving} onCheckedChange={(next) => void change(next)} aria-label="Allow sending without the required extension" />
          <span>Allow sending without it (audited)</span>
        </label>
      ) : undefined}
    >
      <p>{override ? "Sending is allowed because an administrator overrode this. The agent may not behave as it expects." : "Sending is blocked while this is the case."}</p>
      <ul className="mt-1.5 space-y-0.5">
        {unsupported.map((uri) => <li key={uri} className="font-mono text-xs break-all">{uri}</li>)}
      </ul>
      {!admin && <p className="mt-1.5">Ask an administrator if you need to send anyway.</p>}
      {error && <p role="alert" className="text-danger mt-1.5">{error}</p>}
    </Callout>
  );
}
