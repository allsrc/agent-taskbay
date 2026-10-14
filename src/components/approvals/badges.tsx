import { Pill } from "@/components/patterns/status";
import { RISK_TONE, STATUS_LABEL, STATUS_TONE } from "@/lib/approvals";
import type { DecisionRisk, DecisionStatus } from "@/shared/decision-types";

export function DecisionStatusChip({ status, className }: { status: DecisionStatus; className?: string }) {
  return <Pill tone={STATUS_TONE[status]} dot className={className}>{STATUS_LABEL[status]}</Pill>;
}
export function RiskChip({ risk, className }: { risk: DecisionRisk; className?: string }) {
  return <Pill tone={RISK_TONE[risk]} className={className}>{risk.charAt(0).toUpperCase() + risk.slice(1)} risk</Pill>;
}
