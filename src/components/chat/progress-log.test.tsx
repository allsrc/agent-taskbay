import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityLog, ArtifactCard, ProgressLog, UserBubble } from "@/components/chat/timeline";
import type { ThreadMessage } from "@/store/task-store";

const update = (id: string, text: string) => ({ id, role: "agent", fromStatus: true, parts: [{ id: `${id}-p`, kind: "text", value: text, mediaType: "text/plain" }] }) as unknown as ThreadMessage;
const statusData = (id: string, value: Record<string, unknown>) => ({
  id, role: "agent", fromStatus: true, metadata: { adk_author: "knowledge_agent" },
  parts: [{ id: `${id}-p`, kind: "data", value, mediaType: "application/json", metadata: { adk_type: "function_call" } }],
}) as unknown as ThreadMessage;

describe("progress log", () => {
  it("folds in-between updates under a count while the task runs", () => {
    const html = renderToStaticMarkup(<ProgressLog active messages={[update("a", "Fetching the repo"), update("b", "Running tests")]} />);
    expect(html).toContain("Working · 2 updates");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Fetching the repo");
    expect(html).toContain("Running tests");
  });

  it("is labelled as progress once the task has finished", () => {
    const html = renderToStaticMarkup(<ProgressLog active={false} messages={[update("a", "Done")]} />);
    expect(html).toContain("Progress · 1 update");
    expect(html).toContain('aria-expanded="false"');
  });

  it("shows status text once, without format controls or a duplicate details box", () => {
    const html = renderToStaticMarkup(<ProgressLog active messages={[update("a", "Reading the index")]} />);
    expect(html.match(/Reading the index/g)).toHaveLength(1);
    expect(html).not.toContain("Details");
    expect(html).not.toContain("Content view");
  });

  it("shows a tool call as a named step that opens to its JSON, with the sub-agent that ran it", () => {
    const html = renderToStaticMarkup(<ProgressLog active agentName="Knowledge agent" messages={[statusData("call", { id: "call-1", name: "list_directory", args: { path: "/kb" } })]} />);
    expect(html).toContain(">list_directory<");
    expect(html).toContain(">call<");
    expect(html).toContain(">call-1<");
    expect(html).toContain("path: &quot;/kb&quot;");
    expect(html).toContain("knowledge_agent");
    expect(html).toContain("<details");
    expect(html).toContain("/kb");
    expect(html).not.toContain("[data]");
    expect(html).not.toContain("→ You");
  });
});

describe("sent messages", () => {
  it("use a soft brand surface rather than the primary action color", () => {
    const html = renderToStaticMarkup(<UserBubble message={update("sent", "Hello")} />);
    expect(html).toContain("bg-brand-soft");
    expect(html).not.toContain("bg-primary");
    expect(html).toContain("Hello");
  });
});

describe("activity log messages", () => {
  it("keeps standalone tool messages expandable in Activity", () => {
    const message = statusData("call", { id: "call-1", name: "list_directory", args: { path: "/kb" } });
    const html = renderToStaticMarkup(<ActivityLog active artifacts={[]} messages={[message]} />);
    expect(html).toContain("Activity · 1 step");
    expect(html).toContain("list_directory");
    expect(html).toContain("application/json");
  });
});

describe("artifact card", () => {
  it("highlights a finished text result as the outcome", () => {
    const html = renderToStaticMarkup(<ArtifactCard artifact={{ artifactId: "x", name: "Report", complete: true, parts: [{ id: "p", kind: "text", value: "All good", mediaType: "text/plain" }] } as never} />);
    expect(html).toContain("Result");
    expect(html).toContain("Report");
    expect(html).toContain("All good");
  });

  it("formats a Markdown answer and does not repeat Result as the title of an unnamed result", () => {
    const html = renderToStaticMarkup(<ArtifactCard artifact={{ artifactId: "x", complete: true, parts: [{ id: "p", kind: "text", value: "## Summary\n\n- **one**", mediaType: "text/plain" }] } as never} />);
    expect(html).toContain("<strong>one</strong>");
    expect(html).toContain("Completed");
    expect(html.match(/>Result</g)).toHaveLength(1);
  });

  it("keeps HTML source contained until the person previews it", () => {
    const html = renderToStaticMarkup(<ArtifactCard artifact={{ artifactId: "x", complete: true, parts: [{ id: "p", kind: "text", value: "<h1>Hi</h1><p>there</p>", mediaType: "text/html" }] } as never} />);
    expect(html).toContain("<pre");
    expect(html).toContain("Preview HTML");
    expect(html).not.toContain("<h1>Hi</h1>");
  });
});
