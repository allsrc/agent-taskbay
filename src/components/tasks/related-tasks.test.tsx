import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RelatedTasks } from "./related-tasks";
import type { RelatedTask } from "@/shared/task-types";

const task: RelatedTask = { agentId: "agent", tenant: "", canOperate: true, cancelable: true, localId: "00000000-0000-4000-a000-000000000001", taskId: "remote-task-id", agentName: "Agent", state: "TASK_STATE_WORKING", title: "Referenced work" };
describe("related task section", () => {
  it("is hidden without readable relationships", () => {
    expect(renderToStaticMarkup(<RelatedTasks />)).toBe("");
    expect(renderToStaticMarkup(<RelatedTasks related={{ references: [], referencedBy: [] }} />)).toBe("");
  });
  it("labels both directions and links by local ID with state and agent", () => {
    const html = renderToStaticMarkup(<RelatedTasks related={{ references: [task], referencedBy: [{ ...task, localId: "other-local-id", title: "Later work" }] }} />);
    for (const text of ["Related tasks", "References", "Referenced by", "Referenced work", "Later work", "Agent", "Working"]) expect(html).toContain(text);
    expect(html).toContain(`/tasks/${task.localId}`);
    expect(html).not.toContain(`/tasks/${task.taskId}`);
  });
  it("omits empty direction groups, falls back to the remote ID and escapes agent text", () => {
    const html = renderToStaticMarkup(<RelatedTasks related={{ references: [{ ...task, title: undefined, agentName: "<script>bad</script>" }], referencedBy: [] }} />);
    expect(html).toContain("Task remote-t"); expect(html).not.toContain("Referenced by");
    expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;");
  });
});
