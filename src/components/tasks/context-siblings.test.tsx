import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextSiblings } from "./context-siblings";

const sibling = (n: number, extra: object = {}) => ({ localId: `local-${n}`, taskId: `remote-task-${n}`, state: "TASK_STATE_WORKING", updatedAt: "2026-10-10T11:00:00Z", ...extra });
const render = (siblings: Parameters<typeof ContextSiblings>[0]["siblings"], contextId: string | null = "ctx-1") =>
  renderToStaticMarkup(<ContextSiblings siblings={siblings} contextId={contextId ?? undefined} agentId="agent-1" now={Date.parse("2026-10-10T12:00:00Z")} />);

describe("ContextSiblings", () => {
  it("lists each sibling as a link with its state and links to the narrowed Tasks list", () => {
    const html = render([sibling(1, { title: "Fetch statements" }), sibling(2)]);
    expect(html).toContain("Other tasks in this context");
    expect(html).toContain('href="/tasks/local-1"');
    expect(html).toContain("Fetch statements");
    expect(html).toContain("Task remote-t");
    expect(html).toContain("Show all in the Tasks list");
    expect(html).toContain('href="/tasks?contextId=ctx-1&amp;agentId=agent-1"');
  });
  it("renders a hostile title as text", () => {
    const html = render([sibling(1, { title: "<script>x</script>" })]);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("renders nothing without siblings or without a context", () => {
    expect(render([])).toBe("");
    expect(render(undefined)).toBe("");
    expect(render([sibling(1)], null)).toBe("");
  });
});
