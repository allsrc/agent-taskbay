import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArtifactCard, ProgressLog } from "@/components/chat/timeline";
import type { ThreadMessage } from "@/store/task-store";

const update = (id: string, text: string) => ({ id, role: "agent", fromStatus: true, parts: [{ id: `${id}-p`, kind: "text", value: text, mediaType: "text/plain" }] }) as unknown as ThreadMessage;

describe("progress log", () => {
  it("folds in-between updates under a count while the task runs", () => {
    const html = renderToStaticMarkup(<ProgressLog active messages={[update("a", "Fetching the repo"), update("b", "Running tests")]} />);
    expect(html).toContain("Working · 2 updates");
    expect(html).toContain("Fetching the repo");
    expect(html).toContain("Running tests");
  });

  it("is labelled as progress once the task has finished", () => {
    expect(renderToStaticMarkup(<ProgressLog active={false} messages={[update("a", "Done")]} />)).toContain("Progress · 1 update");
  });
});

describe("artifact card", () => {
  it("presents the artifact as the result", () => {
    const html = renderToStaticMarkup(<ArtifactCard artifact={{ artifactId: "x", name: "Report", complete: true, parts: [{ id: "p", kind: "text", value: "All good", mediaType: "text/plain" }] } as never} />);
    expect(html).toContain("Result");
    expect(html).toContain("Report");
    expect(html).toContain("All good");
  });
});
