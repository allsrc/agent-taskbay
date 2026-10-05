import { RISK_TONE, STATUS_LABEL, STATUS_TONE } from "@/lib/approvals";
import type { DecisionRisk, DecisionStatus } from "@/shared/decision-types";
import { cn } from "@/lib/utils";

const pill = "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-medium whitespace-nowrap";
export function DecisionStatusChip({ status, className }: { status: DecisionStatus; className?: string }) {
  return <span className={cn(pill, STATUS_TONE[status], className)}>{STATUS_LABEL[status].toUpperCase()}</span>;
}
export function RiskChip({ risk, className }: { risk: DecisionRisk; className?: string }) {
  return <span className={cn(pill, RISK_TONE[risk], className)}>{risk.toUpperCase()} RISK</span>;
}
