import { describe, expect, it } from "vitest";
import { CommandFailureError, failureFromError, failureFromResponse } from "./command-failure";

const response = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

describe("command failures", () => {
  it("reads the kind, message and details of an API error", async () => {
    expect(await failureFromResponse(response(409, { error: { message: "This task is finished.", kind: "task_terminal", details: { a: 1 } } })))
      .toEqual({ kind: "task_terminal", message: "This task is finished.", status: 409, details: { a: 1 } });
  });
  it("falls back when the body is not JSON or has no message", async () => {
    expect(await failureFromResponse(response(502, "<html>"), "Failed to cancel the task.")).toMatchObject({ message: "Failed to cancel the task.", status: 502, kind: undefined });
    expect(await failureFromResponse(response(500, {}))).toMatchObject({ message: "The request failed." });
  });
  it("keeps the kind of a thrown failure and treats other errors as kind-less", () => {
    expect(failureFromError(new CommandFailureError("x", { kind: "uncertain", status: 409 }))).toMatchObject({ kind: "uncertain", status: 409, message: "x" });
    expect(failureFromError(new Error("network down"))).toEqual({ message: "network down" });
    expect(failureFromError("odd", "Fallback.")).toEqual({ message: "Fallback." });
  });
});
