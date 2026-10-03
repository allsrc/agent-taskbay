"use client";

import { SecuritySettings } from "@/components/security-settings";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { InfoCard } from "@/components/a2a/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { OUTPUT_MODE_OPTIONS, useSettingsStore } from "@/store/settings-store";

function ToggleRow({ title, desc, checked, onChange, disabled }: { title: string; desc: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 py-2">
      <span className="flex-1">
        <span className="block">{title}</span>
        <span className="text-muted-foreground block font-mono text-[11px] break-all">{desc}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={title} />
    </label>
  );
}

export default function SettingsPage() {
  const settings = useSettingsStore();
  const [extension, setExtension] = useState("");

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
      <h1 className="mb-3.5 font-mono text-lg font-bold tracking-tight">Settings</h1>
      <div className="grid max-w-[900px] grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3">
        <InfoCard label="Request defaults">
          <p className="text-muted-foreground mb-1 text-xs">acceptedOutputModes, used when an agent card doesn&apos;t declare its own.</p>
          {OUTPUT_MODE_OPTIONS.map((mode) => (
            <ToggleRow key={mode.key} title={mode.title} desc={mode.key} checked={settings.acceptedOutputModes.includes(mode.key)} onChange={() => settings.toggleOutputMode(mode.key)} />
          ))}
          <ToggleRow title="Return immediately" desc="Get the Task back as soon as it's created" checked={settings.returnImmediately} onChange={settings.setReturnImmediately} />
          <ToggleRow title="Push notifications" desc="Needs the webhook receiver (ROADMAP Phase 1)" checked={false} onChange={() => undefined} disabled />
          <label className="text-muted-foreground flex items-center gap-2 pt-2 font-mono text-xs">
            historyLength
            <Input value={settings.historyLength} onChange={(event) => settings.setHistoryLength(event.target.value)} placeholder="unset" inputMode="numeric" className="h-7 w-20 px-2 font-mono text-xs" />
          </label>
        </InfoCard>

        <InfoCard label="Extensions">
          <p className="text-muted-foreground mb-1 text-xs">Extension URIs activated on every request, in addition to any the gateway negotiates itself.</p>
          {settings.extensions.map((item) => (
            <div key={item.uri} className="flex items-center gap-1">
              <div className="flex-1">
                <ToggleRow title={item.uri.split("/").filter(Boolean).slice(-2).join("/")} desc={item.uri} checked={item.enabled} onChange={() => settings.toggleExtension(item.uri)} />
              </div>
              <Button variant="ghost" size="icon" aria-label="Remove extension" onClick={() => settings.removeExtension(item.uri)}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <form
            className="flex gap-2 pt-2"
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

        <SecuritySettings />
      </div>
    </div>
  );
}
