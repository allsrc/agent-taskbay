import { describe, expect, it } from "vitest";
import { BROWSE_STATUS_OPTIONS, browseUrl } from "./browse-tasks";

describe("browseUrl", () => {
  it("sends only the filters that are set", () => {
    expect(browseUrl("agent", {})).toBe("/api/agents/agent/remote-tasks");
    expect(browseUrl("agent", { status: "TASK_STATE_WORKING", contextId: "", tenant: "", pageToken: "" })).toBe("/api/agents/agent/remote-tasks?status=TASK_STATE_WORKING");
  });
  it("encodes values and the agent ID", () => {
    expect(browseUrl("a/b", { contextId: "x y&z=1", pageToken: "tok?" })).toBe("/api/agents/a%2Fb/remote-tasks?contextId=x+y%26z%3D1&pageToken=tok%3F");
  });
  it("offers only states the route accepts", () => {
    for (const option of BROWSE_STATUS_OPTIONS) expect(option.value === "" || option.value.startsWith("TASK_STATE_")).toBe(true);
    expect(BROWSE_STATUS_OPTIONS[0]).toEqual({ value: "", label: "Any state" });
  });
});
