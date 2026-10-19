"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, ShieldCheck, Trash2 } from "lucide-react";
import { InfoCard } from "@/components/a2a/primitives";
import { Page } from "@/components/console/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cardSurface } from "@/components/patterns/card-surface";
import { useServerResource } from "@/lib/use-server-resource";
import { cn } from "@/lib/utils";
import { OUTPUT_MODE_OPTIONS, useSettingsStore } from "@/store/settings-store";

function ToggleRow({ title, desc, checked, onChange, disabled }: { title: string; desc: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{title}</span>
        <span className="block font-mono text-[11px] break-words text-muted-foreground">{desc}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={title} />
    </label>
  );
}

export default function SettingsPage() {
  const settings = useSettingsStore();
  const [extension, setExtension] = useState("");
  const admin = useServerResource<{ user: { role: string } }>("/api/auth/session").data?.user.role === "admin";

  return (
    <Page
      title="Settings"
      size="default"
      description="Your own defaults for the requests you send. They are saved in this browser and affect only you."
    >
      <section className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <InfoCard label="Request defaults">
            <p className="mb-3 text-xs text-muted-foreground">acceptedOutputModes, used when an agent card doesn&apos;t declare its own.</p>
            <div className="divide-y">
              {OUTPUT_MODE_OPTIONS.map((mode) => (
                <ToggleRow key={mode.key} title={mode.title} desc={mode.key} checked={settings.acceptedOutputModes.includes(mode.key)} onChange={() => settings.toggleOutputMode(mode.key)} />
              ))}
              <ToggleRow title="Return immediately" desc="Get the Task back as soon as it's created" checked={settings.returnImmediately} onChange={settings.setReturnImmediately} />
              <ToggleRow title="Push notifications" desc="Needs the webhook receiver (ROADMAP Phase 1)" checked={false} onChange={() => undefined} disabled />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Label htmlFor="history-length" className="font-mono text-xs text-muted-foreground">historyLength</Label>
              <Input id="history-length" value={settings.historyLength} onChange={(event) => settings.setHistoryLength(event.target.value)} placeholder="unset" inputMode="numeric" className="w-24 font-mono text-xs" />
            </div>
          </InfoCard>

          <InfoCard label="Extensions">
            <p className="mb-3 text-xs text-muted-foreground">Extension URIs activated on every request, in addition to any the gateway negotiates itself.</p>
            <div className="divide-y">
              {settings.extensions.map((item) => (
                <div key={item.uri} className="flex items-center gap-1 py-2.5 first:pt-0">
                  <div className="min-w-0 flex-1">
                    <ToggleRow title={item.uri.split("/").filter(Boolean).slice(-2).join("/")} desc={item.uri} checked={item.enabled} onChange={() => settings.toggleExtension(item.uri)} />
                  </div>
                  <Button variant="ghost" size="icon" aria-label="Remove extension" onClick={() => settings.removeExtension(item.uri)}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
            <form
              className="mt-4 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!extension.trim()) return;
                settings.addExtension(extension.trim());
                setExtension("");
              }}
            >
              <Input value={extension} onChange={(event) => setExtension(event.target.value)} placeholder="https://example.com/a2a/extensions/trace/v1" className="font-mono text-xs" aria-label="Extension URI" />
              <Button type="submit" variant="outline">Add</Button>
            </form>
          </InfoCard>
        </div>
      </section>

      {admin && (
        <Link href={"/admin" as Route} className={cn(cardSurface, "mt-8 flex-row items-center justify-start gap-3 p-4 text-left")}>
          <ShieldCheck className="size-5 text-brand-text" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Organization administration</span>
            <span className="block text-sm text-muted-foreground">People, teams, agent access, escalation and the notification channel now live under Administration.</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground" />
        </Link>
      )}
    </Page>
  );
}
