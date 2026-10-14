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

  it("offers the shared views for plain status text inside collapsed details", () => {
    const html = renderToStaticMarkup(<ProgressLog active messages={[update("a", "**Working**")]} />);
    expect(html).toContain("text/plain · Details");
    expect(html).toContain("Content view");
    expect(html).toContain("Sanitized HTML");
    expect(html).not.toContain('aria-label="Rich HTML preview"');
  });

  it("shows status authors and expandable JSON instead of a [data] placeholder", () => {
    const html = renderToStaticMarkup(<ProgressLog active messages={[statusData("call", { id: "call-1", name: "list_directory", args: { path: "/kb" } })]} />);
    expect(html).toContain("knowledge_agent → You");
    expect(html).toContain("application/json · Details");
    expect(html).toContain("list_directory");
    expect(html).not.toContain("[data]");
  });
});

describe("sent messages", () => {
  it("uses a soft semantic surface rather than the primary action color", () => {
    const html = renderToStaticMarkup(<UserBubble message={update("sent", "Hello")} />);
    expect(html).toContain("bg-secondary text-secondary-foreground");
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
  it("presents the artifact as the result", () => {
    const html = renderToStaticMarkup(<ArtifactCard artifact={{ artifactId: "x", name: "Report", complete: true, parts: [{ id: "p", kind: "text", value: "All good", mediaType: "text/plain" }] } as never} />);
    expect(html).toContain("Result");
    expect(html).toContain("Report");
    expect(html).toContain("All good");
  });

  it("keeps a text result in the Result card with its content type and raw markdown", () => {
    const html = renderToStaticMarkup(<ArtifactCard artifact={{ artifactId: "x", complete: true, parts: [{ id: "p", kind: "text", value: "**bold**", mediaType: "text/plain" }] } as never} />);
    expect(html).toContain("Result");
    expect(html).toContain("Completed");
    expect(html).toContain("text/plain");
    expect(html).toContain("**bold**");
  });
});
