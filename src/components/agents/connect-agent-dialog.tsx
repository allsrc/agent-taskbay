"use client";

import { useState } from "react";
import { ArrowLeft, Link2, Loader2, ShieldCheck, Zap } from "lucide-react";
import { toast } from "sonner";
import { viewAgentCard, type AgentView } from "@/lib/agent-card";
import { AgentAvatar, Chip } from "@/components/a2a/primitives";
import { Callout, Stepper, type StepState } from "@/components/patterns/data-display";
import { DefinitionList } from "@/components/patterns/layout";
import { ResponsiveDialog } from "@/components/patterns/responsive-dialog";
import { Pill } from "@/components/patterns/status";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { useAgentStore } from "@/store/agent-store";
import { useServerResource } from "@/lib/use-server-resource";
import { TaskDiscoveryNotice } from "@/components/agents/task-discovery-notice";

const STEP_TITLES = ["Agent Card", "Review", "Connect"];

/** Administrative registration with optional card preview and separate server credential setup. */
export function ConnectAgentDialog({
  open,
  onOpenChange,
  initialUrl = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialUrl?: string;
}) {
  // The flow mounts only while open, so every open starts from the first step.
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Connect an agent"
      description="Add an A2A agent to the catalog by its Agent Card URL."
      className="sm:max-w-lg"
    >
      {open && <ConnectFlow initialUrl={initialUrl} onDone={() => onOpenChange(false)} />}
    </ResponsiveDialog>
  );
}

/** Mounted only while the dialog is open, so every open starts from step 0. */
function ConnectFlow({ initialUrl, onDone }: { initialUrl: string; onDone: () => void }) {
  const refresh = useAgentStore((state) => state.refresh);
  const session = useServerResource<{ taskDiscoveryCap?: string }>("/api/auth/session");
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState(initialUrl);
  const [nickname, setNickname] = useState("");
  const [view, setView] = useState<AgentView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchCard() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/agents/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardUrl: url }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not fetch the Agent Card.");
      setView(viewAgentCard(body.card));
      setStep(1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not fetch the Agent Card.");
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardUrl: url, nickname: nickname.trim() || null }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Failed to connect the agent.");
      toast.success("Agent connected", { description: nickname.trim() || view?.name });
      await refresh();
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to connect the agent.");
    } finally {
      setBusy(false);
    }
  }

  const schemes = view?.security.length ? view.security : [];
  const steps = STEP_TITLES.map((title, index) => ({
    title,
    state: (index < step ? "complete" : index === step ? "current" : "upcoming") as StepState,
  }));
  const back = (
    <Button variant="ghost" disabled={busy} onClick={() => { setError(null); setStep(step - 1); }}>
      <ArrowLeft /> Back
    </Button>
  );

  return (
    <div className="flex flex-col gap-5">
      <Stepper steps={steps} />

      {step === 0 && (
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => { event.preventDefault(); if (url.trim() && !busy) void fetchCard(); }}
        >
          <Field>
            <FieldLabel htmlFor="card-url">Agent Card URL</FieldLabel>
            <InputGroup>
              <InputGroupAddon><Link2 /></InputGroupAddon>
              <InputGroupInput
                id="card-url"
                type="url"
                autoFocus
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://agents.company.com/.well-known/agent-card.json"
                className="font-mono text-xs"
              />
            </InputGroup>
            <FieldDescription>Fetch the card to review what the agent can do before adding it.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="agent-nickname">Nickname (optional)</FieldLabel>
            <Input id="agent-nickname" value={nickname} maxLength={100} onChange={(event) => setNickname(event.target.value)} placeholder="For example: Support (LangGraph)" />
            <FieldDescription>Your own name for this agent. Use it to tell apart agents whose cards share a name. It must be unique and can be changed later.</FieldDescription>
          </Field>
          <Callout tone="info" icon={ShieldCheck} title="Protected card?">
            Register its URL directly, then configure the credentials on the server.
          </Callout>
          {error && <Callout tone="danger">{error}</Callout>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={busy || !url.trim()} onClick={connect}>Register URL only</Button>
            <Button type="submit" disabled={busy || !url.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Zap />} Fetch Agent Card
            </Button>
          </div>
        </form>
      )}

      {step === 1 && view && (
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3 rounded-xl border bg-sunken p-4">
            <AgentAvatar name={view.name} id={url} size="lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="font-heading text-base font-semibold">{view.name}</div>
              {view.description && <p className="line-clamp-3 text-sm text-muted-foreground">{view.description}</p>}
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                <Chip>v{view.version}</Chip>
                <Chip>{view.skills.length} skill{view.skills.length === 1 ? "" : "s"}</Chip>
                {view.streaming && <Pill tone="success">Streaming</Pill>}
                {view.pushNotifications && <Pill tone="info">Push notifications</Pill>}
              </div>
            </div>
          </div>
          <DefinitionList
            items={[
              { label: "Advertised security", value: schemes.length ? schemes.join(", ") : "None advertised" },
              { label: "Interfaces", value: view.bindings.length ? view.bindings.join(", ") : "—" },
            ]}
          />
          {error && <Callout tone="danger">{error}</Callout>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            {back}
            <Button onClick={() => setStep(2)}>Continue</Button>
          </div>
        </div>
      )}

      {step === 2 && view && (
        <div className="flex flex-col gap-5">
          <div className="space-y-1">
            <h3 className="font-heading text-base font-semibold">Connect {view.name}</h3>
            <p className="text-sm text-muted-foreground">Three things happen from here:</p>
          </div>
          <ol className="space-y-3 text-sm">
            {["The agent is registered in this catalog.", "Configure its service credentials on the server, if it needs any.", "Grant users access in Settings."].map((text, index) => (
              <li key={text} className="flex gap-3">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full border bg-sunken font-mono text-[11px] text-muted-foreground">{index + 1}</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
          <TaskDiscoveryNotice cap={session.data?.taskDiscoveryCap} />
          {error && <Callout tone="danger">{error}</Callout>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            {back}
            <Button disabled={busy} onClick={connect}>
              {busy && <Loader2 className="animate-spin" />} Connect agent
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
