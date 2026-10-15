import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NO_RESPONSE_AFTER_MS, SteeringChip, steeringChip } from "@/components/chat/steering-chip";
import type { SteeringEntry } from "@/shared/task-types";

const sentAt = "2026-10-01T00:00:00.000Z";
const at = Date.parse(sentAt);
const entry = (outcome: SteeringEntry["outcome"], errorKind?: string): SteeringEntry => ({ messageId: "m", commandId: "c", sentAt, outcome, errorKind });

describe("steering outcome chip", () => {
  it("says what Taskbay can tell for each outcome", () => {
    expect(steeringChip(entry("delivered"), at)).toEqual({ tone: "neutral", text: "Delivered" });
    expect(steeringChip(entry("responded"), at)).toEqual({ tone: "success", text: "Agent responded" });
    expect(steeringChip(entry("refused", "unsupported_operation"), at)).toEqual({ tone: "danger", text: "Agent refused: input not accepted" });
    expect(steeringChip(entry("unknown"), at).tone).toBe("warning");
  });

  it("falls back to a plain reason when the agent gave none Taskbay knows", () => {
    expect(steeringChip(entry("refused"), at).text).toBe("Agent refused: no reason given");
    expect(steeringChip(entry("refused", "something_new"), at).text).toBe("Agent refused: no reason given");
  });

  it("changes waiting to no response after 60 seconds, and only that", () => {
    expect(steeringChip(entry("waiting"), at + NO_RESPONSE_AFTER_MS - 1).text).toBe("Waiting for a response");
    expect(steeringChip(entry("waiting"), at + NO_RESPONSE_AFTER_MS).text).toBe("No response yet");
    expect(steeringChip(entry("delivered"), at + 10 * NO_RESPONSE_AFTER_MS).text).toBe("Delivered");
  });

  it("renders the pill as static markup", () => {
    const html = renderToStaticMarkup(<SteeringChip entry={entry("responded")} now={at} />);
    expect(html).toContain("Agent responded");
    expect(html).toContain('data-testid="steering-chip"');
  });
});
