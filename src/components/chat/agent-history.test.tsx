import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AGENT_HISTORY_NOTE, AgentHistoryDivider, LoadAgentHistoryButton, canLoadAgentHistory, splitAgentHistory } from "@/components/chat/agent-history";
import type { ThreadMessage } from "@/store/task-store";

const message = (id: string, origin?: "agent-history") => ({ id, role: "agent", parts: [], timestamp: "2026-10-01T00:00:00Z", ...(origin ? { origin } : {}) }) as ThreadMessage;

describe("agent history in the timeline", () => {
  it("offers the button for a task with an id on the agent", () => {
    const html = renderToStaticMarkup(<LoadAgentHistoryButton task={{ kind: "task", localId: "local", taskId: "remote" }} onLoaded={() => {}} />);
    expect(html).toContain("Load agent history");
    expect(html).not.toContain('disabled=""');
  });

  it("hides the button for a direct message and for a task without a remote id", () => {
    expect(renderToStaticMarkup(<LoadAgentHistoryButton task={{ kind: "message", localId: "local", taskId: "local" }} onLoaded={() => {}} />)).toBe("");
    expect(renderToStaticMarkup(<LoadAgentHistoryButton task={{ kind: "task", localId: "local", taskId: "" }} onLoaded={() => {}} />)).toBe("");
    expect(canLoadAgentHistory({ kind: "task", localId: undefined, taskId: "remote" })).toBe(false);
  });

  it("separates what Taskbay received from what only the agent returned", () => {
    const { received, history } = splitAgentHistory([message("a"), message("b", "agent-history"), message("c"), message("d", "agent-history")]);
    expect(received.map((item) => item.id)).toEqual(["a", "c"]);
    expect(history.map((item) => item.id)).toEqual(["b", "d"]);
  });

  it("labels the two sections as separators and keeps the incompleteness note", () => {
    const html = renderToStaticMarkup(<><AgentHistoryDivider>What Taskbay received</AgentHistoryDivider><AgentHistoryDivider>History the agent returned</AgentHistoryDivider></>);
    expect(html).toContain('role="separator"');
    expect(html).toContain("What Taskbay received");
    expect(html).toContain("History the agent returned");
    expect(AGENT_HISTORY_NOTE).toBe("The agent chooses what history to keep. It may be incomplete.");
  });
});
