import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiscoveredTaskNotice } from "./discovered-task-notice";
import { DiscoveredMarker } from "@/components/chat/discovered-marker";

const render = (task: Parameters<typeof DiscoveredTaskNotice>[0]["task"]) => renderToStaticMarkup(<DiscoveredTaskNotice task={task} />);

// The repository has no browser test environment, so these check what is rendered; dismissal runs in the browser and falls back to memory when storage throws.
describe("DiscoveredTaskNotice", () => {
  it("tells a person where the task came from and what they can do", () => {
    const html = render({ localId: "l", origin: "discovered", trackedBy: null });
    expect(html).toContain("Started outside Taskbay");
    expect(html).toContain("You can answer it, send it more input or cancel it here.");
    expect(html).toContain("Dismiss");
    expect(html).not.toContain("Tracked by");
  });
  it("says who tracked it and when", () => {
    expect(render({ localId: "l", origin: "discovered", trackedBy: { userId: "u", name: "Dana" }, discoveredAt: "2026-10-09T07:30:00.000Z" })).toContain("Tracked by Dana on 2026-10-09.");
  });
  it("shows a tracker's name as text only", () => {
    const html = render({ localId: "l", origin: "discovered", trackedBy: { userId: "u", name: "<b>Dana</b>" } });
    expect(html).toContain("&lt;b&gt;Dana&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });
  it("shows nothing for a task started from Taskbay", () => {
    expect(render({ localId: "l", origin: undefined, trackedBy: undefined })).toBe("");
    expect(render({ localId: "l", origin: "created" })).toBe("");
  });
});

describe("DiscoveredMarker", () => {
  it("says when Taskbay found the task", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    expect(renderToStaticMarkup(<DiscoveredMarker task={{ createdAt: "2026-10-10T11:00:00Z", discoveredAt: "2026-10-10T11:56:00Z" }} now={now} />)).toContain("Started outside Taskbay · found 4m ago");
  });
});
