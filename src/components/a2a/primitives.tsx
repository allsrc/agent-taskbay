import { agentBadge } from "@/lib/agent-card";
import { STATE_COLOR, stateName } from "@/lib/task-view";
import { cn } from "@/lib/utils";

/** Task state pill: INPUT_REQUIRED in amber, AUTH_REQUIRED in purple, COMPLETED in green, ... */
export function StateChip({ state, className }: { state: string; className?: string }) {
  const name = stateName(state);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-medium whitespace-nowrap",
        STATE_COLOR[name] ?? STATE_COLOR.SUBMITTED,
        className,
      )}
    >
      {name === "MESSAGE_ONLY" ? "MESSAGE" : name}
    </span>
  );
}

/** Small monospace chip for media types, bindings and ids. */
export function Chip({ children, className, tone }: { children: React.ReactNode; className?: string; tone?: "warn" }) {
  return (
    <span
      className={cn(
        "bg-secondary border-border inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium",
        tone === "warn" && "border-warning/50 text-warning",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function AgentAvatar({ name, id, size = "md" }: { name: string; id: string; size?: "sm" | "md" | "lg" }) {
  const { short, color } = agentBadge(name, id);
  const box = size === "lg" ? "size-[52px] rounded-2xl text-[17px]" : size === "sm" ? "size-[34px] rounded-[10px] text-xs" : "size-[38px] rounded-[10px] text-[13px]";
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center font-mono font-bold", box)}
      style={{ background: `${color}22`, color }}
      aria-hidden
    >
      {short}
    </div>
  );
}

/** Dark card with the prototype's mono caption label. */
export function InfoCard({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("bg-card border-border rounded-xl border p-3.5", className)}>
      <h3 className="label-mono mb-1.5">{label}</h3>
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="m-auto flex max-w-sm flex-col items-center gap-3 p-8 text-center">
      <div className="text-primary">{icon}</div>
      <p className="font-mono text-base font-bold">{title}</p>
      {children && <div className="text-muted-foreground text-sm">{children}</div>}
    </div>
  );
}

/** Desktop: list pane + detail side by side. Mobile: one at a time, chosen by `showDetail`. */
export function SplitPane({ list, children, showDetail }: { list: React.ReactNode; children: React.ReactNode; showDetail: boolean }) {
  return (
    <div className="flex min-h-0 flex-1">
      <div className={cn("border-border min-h-0 w-full flex-col md:flex md:w-80 md:shrink-0 md:border-r", showDetail ? "hidden" : "flex")}>{list}</div>
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col md:flex", showDetail ? "flex" : "hidden")}>{children}</div>
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="text-primary mb-3 inline-block font-mono text-[13px] font-medium md:hidden">
      ← {children}
    </a>
  );
}
