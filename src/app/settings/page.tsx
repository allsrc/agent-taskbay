"use client";

import { SecuritySettings } from "@/components/security-settings";
import { EscalationSettings } from "@/components/escalation-settings";
import { NotificationChannelSettings } from "@/components/notification-channel-settings";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { InfoCard } from "@/components/a2a/primitives";
import { Page } from "@/components/console/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

  return (
    <Page
      title="Settings"
      size="default"
      description="Defaults for the requests you send, and, for administrators, who can reach which agents."
    >
      <section className="space-y-4">
        <div>
          <h2 className="font-heading text-base font-semibold">Saved in this browser</h2>
          <p className="text-sm text-muted-foreground">Request defaults and extensions apply to your chats on this device.</p>
        </div>
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

      {/* Administrator cards render nothing for other roles, so the heading shows only when a card did. */}
      <div className="mt-10 flex flex-col gap-4">
        <div className="peer order-2 grid gap-4 empty:hidden lg:grid-cols-2 lg:items-start">
          <SecuritySettings />
          <EscalationSettings />
          <NotificationChannelSettings />
        </div>
        <div className="order-1 hidden peer-[:not(:empty)]:block">
          <h2 className="font-heading text-base font-semibold">Organization settings</h2>
          <p className="text-sm text-muted-foreground">Visible to administrators only. The server enforces access regardless.</p>
        </div>
      </div>
    </Page>
  );
}
