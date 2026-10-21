"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { InfoCard } from "@/components/a2a/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Lets an administrator give this registration its own name, to tell apart agents whose cards advertise the same name
 * (for example the same agent built with two frameworks). The nickname replaces the card name across the console; nicknames are unique.
 */
export function AgentNicknameCard({ agentId, nickname, cardName, admin, onChanged }: {
  agentId: string;
  nickname?: string;
  /** The name the agent's card advertises; undefined when the card could not be fetched. */
  cardName?: string;
  admin: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [value, setValue] = useState(nickname ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/agents/${agentId}/settings`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: next.trim() || null }) });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? "Could not save the nickname.");
      setValue(next.trim());
      await onChanged();
      toast.success(next.trim() ? "Nickname saved" : "Nickname cleared");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the nickname.");
    } finally {
      setSaving(false);
    }
  }

  const dirty = value.trim() !== (nickname ?? "");
  return (
    <InfoCard label="Nickname">
      <p className="text-sm text-muted-foreground">
        {cardName ? <>The agent calls itself <span className="font-medium text-foreground">{cardName}</span>. </> : null}
        A nickname replaces that name everywhere in the console, so you can tell agents with the same name apart. It must be unique.
      </p>
      {admin ? (
        <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); if (dirty && !saving) void save(value); }}>
          <Input value={value} onChange={(event) => setValue(event.target.value)} maxLength={100} placeholder="For example: Support (LangGraph)" aria-label="Nickname" disabled={saving} />
          <Button type="submit" disabled={saving || !dirty}>{saving && <Loader2 className="animate-spin" />} Save</Button>
          {nickname && <Button type="button" variant="outline" disabled={saving} onClick={() => void save("")}>Clear</Button>}
        </form>
      ) : (
        <p className="mt-3 text-sm">{nickname ? <span className="font-medium">{nickname}</span> : <span className="text-muted-foreground">None set. An administrator can set one.</span>}</p>
      )}
      {error && <p role="alert" className="text-danger mt-2 text-sm">{error}</p>}
    </InfoCard>
  );
}
