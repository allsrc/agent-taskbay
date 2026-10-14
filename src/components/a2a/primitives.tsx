import { agentBadge } from "@/lib/agent-card";
import { STATE_TONE, stateLabel, stateName } from "@/lib/task-view";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/patterns/layout";
import { Pill, Tag } from "@/components/patterns/status";

/** Task state pill: tone follows the wire state (input required is amber, completed green, failed red, ...). */
export function StateChip({ state, className }: { state: string; className?: string }) {
  const name = stateName(state);
  return (
    <Pill tone={STATE_TONE[name] ?? "neutral"} dot live={name === "WORKING"} className={className}>
      {stateLabel(state)}
    </Pill>
  );
}

/** Small monospace chip for media types, bindings and ids. */
export function Chip({ children, className, tone }: { children: React.ReactNode; className?: string; tone?: "warn" }) {
  return <Tag className={cn(tone === "warn" && "bg-warning/10 text-warning", className)}>{children}</Tag>;
}

export function AgentAvatar({ name, id, size = "md" }: { name: string; id: string; size?: "xs" | "sm" | "md" | "lg" }) {
  const { short, color } = agentBadge(name, id);
  const box = size === "xs" ? "size-5 rounded-md text-[9px]" : size === "lg" ? "size-14 rounded-2xl text-lg" : size === "sm" ? "size-8 rounded-lg text-xs" : "size-10 rounded-xl text-sm";
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center font-mono font-semibold", box)}
      style={{ background: `color-mix(in oklch, ${color} 16%, transparent)`, color }}
      aria-hidden
    >
      {short}
    </div>
  );
}

/** A titled card for grouped facts. */
export function InfoCard({ label, children, className, action }: { label: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <Panel title={label} action={action} className={className} bodyClassName="p-4">
      {children}
    </Panel>
  );
}

/** Empty or missing state, centred in the pane it fills. */
export function EmptyState({ icon: Icon, title, children, action, className }: {
  icon: React.ComponentType<{ className?: string }>; title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-1 items-center justify-center p-6 md:p-10", className)}>
      <div className="flex max-w-sm flex-col items-center text-center">
        <span className="flex size-11 items-center justify-center rounded-xl border bg-sunken text-muted-foreground">
          <Icon className="size-5" />
        </span>
        <h2 className="mt-4 font-heading text-sm font-semibold">{title}</h2>
        {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}
