import { describe, expect, it } from "vitest";
import { buildSequence, type WireEntry } from "./wire-sequence";

const out = (id: number, at: number, json: unknown): WireEntry => ({ id, at, dir: "out", kind: "SendMessage", json });
const inn = (id: number, at: number, kind: string, json: unknown): WireEntry => ({ id, at, dir: "in", kind, json });

describe("buildSequence", () => {
  it("opens a turn per request and lists responses in order", () => {
    const turns = buildSequence([
      out(1, 1000, { method: "SendMessage", params: { message: { parts: [{ text: "Review it" }], taskId: "task-8421-abc" } } }),
      inn(2, 1400, "task", { task: { id: "t", status: { state: "TASK_STATE_SUBMITTED" } } }),
      inn(3, 1900, "statusUpdate", { statusUpdate: { status: { state: "TASK_STATE_INPUT_REQUIRED", message: { parts: [{ text: "Which env?" }] } } } }),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].rows.map((row) => row.label)).toEqual(["SendMessage", "task", "statusUpdate"]);
    expect(turns[0].rows[0].detail).toBe("Review it → task-842");
    expect(turns[0].rows[2]).toMatchObject({ state: "TASK_STATE_INPUT_REQUIRED", detail: "Which env?", offset: 900 });
  });

  it("collapses artifact chunks of one artifact into a single row", () => {
    const chunk = (id: number) => inn(id, 2000 + id, "artifactUpdate", { artifactUpdate: { artifact: { artifactId: "r1", name: "report.md" }, append: true } });
    const [turn] = buildSequence([out(1, 1000, { method: "SendMessage" }), chunk(2), chunk(3), chunk(4)]);
    expect(turn.rows).toHaveLength(2);
    expect(turn.rows[1]).toMatchObject({ label: "artifactUpdate", detail: "report.md", count: 3 });
  });

  it("starts a new turn for a later request and marks cancels", () => {
    const turns = buildSequence([out(1, 0, { method: "SendMessage" }), out(2, 5000, { method: "CancelTask" })]);
    expect(turns.map((turn) => turn.title)).toEqual(["SendMessage", "CancelTask"]);
    expect(turns[1].rows[0].tone).toBe("cancel");
  });

  it("keeps events that arrive before any request (resubscribe) in an implicit turn", () => {
    const turns = buildSequence([inn(1, 10, "statusUpdate", { statusUpdate: { status: { state: "TASK_STATE_WORKING" } } })]);
    expect(turns[0].rows[0].state).toBe("TASK_STATE_WORKING");
  });
});
