import { describe, expect, it } from "vitest";
import { contextListHref, taskListQuery } from "./task-list-query";

describe("task list query", () => {
  it("builds the API query from the view", () => {
    expect(taskListQuery({ filter: "all" })).toBe("filter=all&limit=50");
    expect(taskListQuery({ filter: "done", origin: "discovered", contextId: "c 1", agentId: "a", after: "abc" }, 25))
      .toBe("filter=done&limit=25&origin=discovered&contextId=c+1&agentId=a&after=abc");
  });
  it("links to one context of one agent, escaping the ids", () => {
    expect(contextListHref("ctx/1&x", "agent-1")).toBe("/tasks?contextId=ctx%2F1%26x&agentId=agent-1");
  });
});
