"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { viewAgentCard, type AgentView } from "@/lib/agent-card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAgentStore } from "@/store/agent-store";
import { cn } from "@/lib/utils";

const STEPS = 3;

/** The prototype's three-step "Connect agent" flow: Agent Card URL → security scheme → connect. */
export function ConnectAgentDialog({
  open,
  onOpenChange,
  initialUrl = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialUrl?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border max-md:top-auto max-md:bottom-0 max-md:translate-y-0 max-md:rounded-b-none max-md:rounded-t-2xl sm:max-w-[440px]">
        <ConnectFlow initialUrl={initialUrl} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so every open starts from step 0. */
function ConnectFlow({ initialUrl, onDone }: { initialUrl: string; onDone: () => void }) {
  const refresh = useAgentStore((state) => state.refresh);
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState(initialUrl);
  const [view, setView] = useState<AgentView | null>(null);
  const [scheme, setScheme] = useState(0);
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
        body: JSON.stringify({ cardUrl: url }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Failed to connect the agent.");
      toast.success("Agent connected", { description: view?.name });
      await refresh();
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to connect the agent.");
    } finally {
      setBusy(false);
    }
  }

  const schemes = view?.security.length ? view.security : ["None advertised"];

  return (
        <div className="flex flex-col gap-3.5">
          <DialogTitle className="font-mono text-[17px] font-bold">Connect agent</DialogTitle>
          <DialogDescription className="sr-only">Connect an A2A agent by its Agent Card URL.</DialogDescription>
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: STEPS }, (_, index) => (
              <div key={index} className={cn("h-[3px] flex-1 rounded-full transition-colors", index <= step ? "bg-primary" : "bg-border")} />
            ))}
          </div>

          {step === 0 && (
            <>
              <label htmlFor="card-url" className="label-mono">Agent Card URL</label>
              <Input
                id="card-url"
                type="url"
                autoFocus
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://agents.company.com/.well-known/agent-card.json"
                className="border-primary font-mono text-xs"
              />
              <Button variant="brand" size="lg" disabled={busy || !url.trim()} onClick={fetchCard}>
                {busy && <Loader2 className="animate-spin" />} Fetch Agent Card
              </Button>
            </>
          )}

          {step === 1 && view && (
            <>
              <div className="bg-card border-border rounded-xl border p-3.5">
                <div className="font-semibold">{view.name}</div>
                <div className="text-muted-foreground text-[13px]">
                  v{view.version} · {view.skills.length} skills{view.streaming ? " · streaming" : ""}
                  {view.pushNotifications ? " · push notifications" : ""}
                </div>
              </div>
              <span className="label-mono">Security scheme</span>
              {schemes.map((label, index) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setScheme(index)}
                  className={cn("flex items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-left", scheme === index ? "border-primary" : "border-border")}
                >
                  <span className={cn("size-3 rounded-full border-2", scheme === index ? "border-primary bg-primary" : "border-muted-foreground")} />
                  {label}
                </button>
              ))}
              <Button variant="brand" size="lg" onClick={() => setStep(2)}>
                Continue
              </Button>
            </>
          )}

          {step === 2 && view && (
            <>
              <div className="bg-card border-border flex flex-col gap-1.5 rounded-xl border p-3.5">
                <div className="font-semibold">Connect {view.name}</div>
                <p className="text-muted-foreground text-[13px]">
                  This client will send messages, read tasks and cancel them. Credential exchange for {schemes[scheme]} is not built yet, so requests go out
                  unauthenticated for now (see ROADMAP Phase 2).
                </p>
              </div>
              <Button variant="brand" size="lg" disabled={busy} onClick={connect}>
                {busy && <Loader2 className="animate-spin" />} Connect
              </Button>
            </>
          )}

          {error && <p className="text-brand text-sm">{error}</p>}
        </div>
  );
}
