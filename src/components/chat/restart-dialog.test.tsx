import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RestartSteps } from "@/components/chat/restart-dialog";
import { initialRestart, type RestartProgress } from "@/lib/restart-task";

const render = (progress: RestartProgress, props: Partial<Parameters<typeof RestartSteps>[0]> = {}) =>
  renderToStaticMarkup(<RestartSteps taskTitle="Reconcile invoices" progress={progress} {...props} />);

describe("restart dialog steps", () => {
  it("names both steps, the old task, and says partial work may not be kept", () => {
    const html = render(initialRestart());
    expect(html).toContain("1. Cancel");
    expect(html).toContain("Reconcile invoices");
    expect(html).toContain("the agent decides whether it stops");
    expect(html).toContain("2. Start a new task in this conversation with your instruction, referencing the old one.");
    expect(html).toContain("Partial work may or may not be kept. Taskbay cannot tell.");
    expect(html).not.toContain("<button");
  });

  it("shows each step's result as it goes", () => {
    const html = render({ cancel: { status: "done" }, start: { status: "running" } });
    expect(html).toContain('data-step="cancel" data-status="done"');
    expect(html).toContain('data-step="start" data-status="running"');
  });

  it("explains a refused cancel, says nothing else changed, and offers extra input", () => {
    const html = render({ cancel: { status: "failed", failure: { kind: "unsupported_operation", message: "x" } }, start: { status: "skipped" } }, { onSendAsInput: () => {} });
    expect(html).toContain("This agent does not support that action.");
    expect(html).toContain("The new task was not started and nothing else changed.");
    expect(html).toContain("Send as extra input instead");
    expect(html).toContain('data-step="start" data-status="skipped"');
  });

  it("says the cancel stands when the new task fails, and offers a retry of step 2 only", () => {
    const html = render({ cancel: { status: "done" }, start: { status: "failed", failure: { kind: "content_type_not_supported", message: "x" } } }, { onRetryStart: () => {} });
    expect(html).toContain("The old task was canceled, but the new task was not started.");
    expect(html).toContain("Try step 2 again");
    expect(html).not.toContain("Send as extra input instead");
  });

  it("notes a task that had already finished", () => {
    expect(render({ cancel: { status: "done", alreadyFinished: true }, start: { status: "waiting" } })).toContain("The task had already finished.");
  });

  it("describes an uncertain start without claiming that it did not happen", () => {
    const html = render({ cancel: { status: "done" }, start: { status: "failed", failure: { kind: "uncertain", message: "unknown" } } }, { onRetryStart: () => {} });
    expect(html).toContain("Taskbay cannot confirm whether the new task started.");
    expect(html).toContain("Check step 2 again");
    expect(html).not.toContain("but the new task was not started");
  });
});
