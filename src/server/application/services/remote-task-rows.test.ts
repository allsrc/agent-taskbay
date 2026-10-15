import { describe, expect, it } from "vitest";
import type { JsonValue } from "../../domain/persistence-model";
import { plainSnippet, remoteTaskRow, remoteTaskRows, validateTrackedTask } from "./remote-task-rows";

const task = (extra: Record<string, unknown> = {}): JsonValue => ({ id: "t1", contextId: "c1", status: { state: "TASK_STATE_WORKING", timestamp: "2026-10-01T00:00:00Z" }, ...extra }) as JsonValue;

describe("remoteTaskRow", () => {
  it("keeps only what is shown, and drops everything else the agent sent", () => {
    const row = remoteTaskRow(task({ artifacts: [{ big: "x" }], history: [{ secret: "y" }], extra: "z" }));
    expect(row).toEqual({ taskId: "t1", contextId: "c1", state: "TASK_STATE_WORKING", updatedAt: "2026-10-01T00:00:00.000Z", title: null, snippet: null });
  });
  it("takes the first text of the status message as a one-line snippet", () => {
    const row = remoteTaskRow(task({ status: { state: "TASK_STATE_INPUT_REQUIRED", message: { parts: [{ data: {} }, { text: "  Which\n ledger\tshould I use?  " }, { text: "second" }] } } }));
    expect(row?.snippet).toBe("Which ledger should I use?");
  });
  it("truncates a long snippet and title", () => {
    expect(plainSnippet("x".repeat(500), 120)).toBe(`${"x".repeat(119)}…`);
    expect(remoteTaskRow(task({ metadata: { title: "t".repeat(500) } }))?.title).toHaveLength(200);
  });
  it("strips control and direction-override characters and never returns markup as anything but text", () => {
    expect(plainSnippet("a\u0000b‮c⁦d\u0085e", 50)).toBe("abcde");
    expect(remoteTaskRow(task({ status: { state: "TASK_STATE_WORKING", message: { parts: [{ text: "<img src=x onerror=alert(1)>" }] } } }))?.snippet).toBe("<img src=x onerror=alert(1)>");
  });
  it.each([
    ["no id", { id: "" }], ["long id", { id: "x".repeat(256) }], ["numeric id", { id: 5 }], ["no state", { status: {} }], ["unknown state", { status: { state: "TASK_STATE_NOPE" } }], ["no status", { status: undefined }],
  ])("drops an entry with %s", (_label, extra) => expect(remoteTaskRow(task(extra))).toBeUndefined());
  it("ignores an invalid timestamp and a context that is not an ID", () => {
    expect(remoteTaskRow(task({ contextId: 7, status: { state: "TASK_STATE_WORKING", timestamp: "yesterday" } }))).toMatchObject({ contextId: null, updatedAt: null });
  });
  it("drops non-object entries", () => { for (const entry of [null, "x", 3, [], true]) expect(remoteTaskRow(entry as JsonValue)).toBeUndefined(); });
});

describe("remoteTaskRows", () => {
  it("counts what it drops and skips tasks for another tenant", () => {
    const { rows, dropped } = remoteTaskRows([task(), task({ id: "t2", metadata: { tenant: "other" } }), task({ id: "t3", metadata: { tenant: "mine" } }), { nope: true }] as JsonValue[], "mine");
    expect(rows.map((row) => row.taskId)).toEqual(["t1", "t3"]);
    expect(dropped).toBe(2);
  });
});

describe("validateTrackedTask", () => {
  const read = (extra: Record<string, unknown> = {}) => ({ task: { id: "t1", status: { state: "TASK_STATE_WORKING" }, ...extra } }) as JsonValue;
  it("accepts the task that was asked for", () => expect(validateTrackedTask(read(), "t1", "")).toBeUndefined());
  it("refuses another task, another tenant, or a task without a valid state", () => {
    expect(validateTrackedTask(read(), "other", "")).toMatch(/different task/);
    expect(validateTrackedTask(read({ metadata: { tenant: "x" } }), "t1", "")).toMatch(/another tenant/);
    expect(validateTrackedTask(read({ status: { state: "TASK_STATE_NOPE" } }), "t1", "")).toMatch(/valid state/);
    expect(validateTrackedTask({ message: {} } as JsonValue, "t1", "")).toMatch(/different task/);
  });
});
