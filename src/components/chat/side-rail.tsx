"use client";

import { useSyncExternalStore } from "react";
import { PanelRightClose } from "lucide-react";
import { OptionsPanel, type OptionsPanelProps } from "@/components/chat/options-panel";
import { SequencePanel, type WireEntry } from "@/components/chat/wire-panel";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export type RailTab = "sequence" | "options";

const query = "(min-width: 1024px)";
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
/** True from the `lg` breakpoint up, where the rail sits beside the chat instead of in a sheet. */
export function useIsDesktop() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

function RailBody({
  tab,
  onTab,
  entries,
  agentName,
  options,
  onClose,
}: {
  tab: RailTab;
  onTab: (tab: RailTab) => void;
  entries: WireEntry[];
  agentName: string;
  options: OptionsPanelProps;
  onClose?: () => void;
}) {
  const tabs: Array<{ key: RailTab; label: string }> = [
    { key: "sequence", label: "Sequence" },
    { key: "options", label: "Options" },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border flex shrink-0 items-center gap-1 border-b px-3 py-2.5" role="tablist" aria-label="Side panel">
        {tabs.map((item) => (
          <button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => onTab(item.key)}
            className={cn(
              "rounded-md px-2.5 py-1 font-mono text-xs font-medium transition-colors",
              tab === item.key ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
            {item.key === "sequence" && entries.length > 0 && <span className="text-muted-foreground ml-1.5">{entries.length}</span>}
          </button>
        ))}
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Hide panel" className="text-muted-foreground hover:text-foreground ml-auto rounded-md p-1">
            <PanelRightClose className="size-4" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {tab === "sequence" ? <SequencePanel entries={entries} agentName={agentName} /> : <OptionsPanel {...options} />}
      </div>
    </div>
  );
}

/**
 * Desktop: a rail on the right of the chat, using the width the message column doesn't need.
 * Smaller screens: the same content in a sheet.
 */
export function SideRail({
  open,
  onOpenChange,
  ...body
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: RailTab;
  onTab: (tab: RailTab) => void;
  entries: WireEntry[];
  agentName: string;
  options: OptionsPanelProps;
}) {
  const desktop = useIsDesktop();
  if (desktop) {
    if (!open) return null;
    return (
      <aside className="bg-card border-border hidden min-h-0 w-[400px] shrink-0 flex-col border-l lg:flex xl:w-[440px]" aria-label="Request details">
        <RailBody {...body} onClose={() => onOpenChange(false)} />
      </aside>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="bg-card flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetTitle className="sr-only">Request details</SheetTitle>
        <SheetDescription className="sr-only">The A2A message sequence and per-request options.</SheetDescription>
        <RailBody {...body} />
      </SheetContent>
    </Sheet>
  );
}
