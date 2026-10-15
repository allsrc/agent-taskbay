"use client";

import { useEffect, useState } from "react";
import { Pill } from "@/components/patterns/status";
import type { Tone } from "@/lib/tone";
import type { SteeringEntry } from "@/shared/task-types";

/** After this long without anything from the agent, "Waiting for a response" becomes "No response yet". Decided in the browser; the server does not change. */
export const NO_RESPONSE_AFTER_MS = 60_000;

/** Short, fixed wording for why an agent refused. Only the kind picks it; agent text is never shown here. */
const REFUSAL: Record<string, string> = {
  unsupported_operation: "input not accepted",
  content_type_not_supported: "content type not supported",
  invalid_request: "malformed request",
  task_not_found: "task not found",
  task_not_cancelable: "not allowed now",
  extension_required: "extension required",
  version_not_supported: "protocol version not supported",
};
export const refusalLabel = (kind?: string) => (kind && REFUSAL[kind]) || "no reason given";

export function steeringChip(entry: Pick<SteeringEntry, "outcome" | "errorKind" | "sentAt">, now: number): { tone: Tone; text: string } {
  switch (entry.outcome) {
    case "delivered": return { tone: "neutral", text: "Delivered" };
    case "responded": return { tone: "success", text: "Agent responded" };
    case "refused": return { tone: "danger", text: `Agent refused: ${refusalLabel(entry.errorKind)}` };
    case "unknown": return { tone: "warning", text: "Not sure it arrived" };
    default: {
      const sent = Date.parse(entry.sentAt);
      return { tone: "neutral", text: Number.isFinite(sent) && now - sent >= NO_RESPONSE_AFTER_MS ? "No response yet" : "Waiting for a response" };
    }
  }
}

/** The state of a message sent to a working task. It says what Taskbay can tell, not what the agent did with the input. */
export function SteeringChip({ entry, now }: { entry: SteeringEntry; now?: number }) {
  const [clock, setClock] = useState(() => now ?? Date.now());
  const waiting = entry.outcome === "waiting";
  useEffect(() => {
    if (!waiting) return;
    const remaining = Date.parse(entry.sentAt) + NO_RESPONSE_AFTER_MS - Date.now();
    if (!(remaining > 0)) return;
    const timer = setTimeout(() => setClock(Date.now()), remaining + 50);
    return () => clearTimeout(timer);
  }, [waiting, entry.sentAt]);
  const chip = steeringChip(entry, now ?? clock);
  return (
    <div className="flex justify-end" data-testid="steering-chip">
      <Pill tone={chip.tone}>{chip.text}</Pill>
    </div>
  );
}
