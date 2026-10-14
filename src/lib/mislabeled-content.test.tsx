import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ContentViewer } from "@/components/content-viewer";
import { profileContent, resolveView } from "@/lib/content-view";
import cases from "../../scripts/fixtures/mislabeled-content.json";
import { startContentAgent } from "../../scripts/fixture-content-agent.mjs";

type Case = { id: string; mediaType: string; text: string; expect: { view: string; html?: boolean; suggestion?: string } };

describe("content an agent sent under the wrong media type", () => {
  it.each(cases as Case[])("$id: shown as $expect.view", ({ text, mediaType, expect: expected }) => {
    const profile = profileContent(text, mediaType, { infer: true });
    expect(resolveView(profile, "auto")).toBe(expected.view);
    if (expected.html !== undefined) expect(profile.html).toBe(expected.html);
    if (expected.suggestion) expect(profile.suggestion).toBe(expected.suggestion);
    const html = renderToStaticMarkup(<ContentViewer text={text} mediaType={mediaType} />);
    expect(html).not.toMatch(/<script|<style|<iframe/);
    // HTML is never rendered by itself: it stays contained source with a preview on request.
    if (profile.html && expected.view === "text") {
      expect(html).toContain("<pre");
      expect(html).toContain("Preview HTML");
    }
    if (!profile.html) expect(html).not.toContain("Preview HTML");
  });

  it("keeps a person's own messages as they were sent, offering the detected view instead", () => {
    const json = profileContent('{"ok":true}', "text/plain");
    expect(json.defaultView).toBe("text");
    expect(json.suggestion).toBe("json");
    const markdown = profileContent("## Title\n\n- one", "text/plain");
    expect(markdown.defaultView).toBe("text");
    expect(markdown.suggestion).toBe("markdown");
    // A declared type the content does not fit still falls back to text.
    expect(profileContent('{"a":', "application/json").defaultView).toBe("text");
    expect(profileContent("Just words", "text/csv").defaultView).toBe("text");
  });
});

describe("mislabeled content fixture agent", () => {
  let agent: { origin: string; cardUrl: string; close: () => Promise<void> };
  beforeAll(async () => { agent = await startContentAgent(0, { delayMs: 1 }); });
  afterAll(async () => agent.close());

  const rpc = async (method: string, params: unknown) => {
    const response = await fetch(`${agent.origin}/a2a`, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    return (await response.json()).result;
  };
  const settle = async (taskId: string) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const task = await rpc("GetTask", { id: taskId });
      if (task.status.state === "TASK_STATE_COMPLETED") return task;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("The fixture task did not complete.");
  };
  const send = async (text: string) => (await rpc("SendMessage", { message: { messageId: text, role: "ROLE_USER", parts: [{ text }] } })).task.id as string;

  it("advertises streaming on its card", async () => {
    const card = await (await fetch(agent.cardUrl)).json();
    expect(card.capabilities.streaming).toBe(true);
  });

  it("sends every case as a result artifact with its wrong media type", async () => {
    const task = await settle(await send("results"));
    expect(task.artifacts).toHaveLength(cases.length);
    expect(task.artifacts.find((artifact: { artifactId: string }) => artifact.artifactId === "html-json").parts[0].mediaType).toBe("text/html");
  });

  it("can put every case in the final reply, or send one case by id", async () => {
    const reply = await settle(await send("reply"));
    expect(reply.status.message.parts).toHaveLength(cases.length);
    const single = await settle(await send("plain-json"));
    expect(single.artifacts.map((artifact: { artifactId: string }) => artifact.artifactId)).toEqual(["plain-json"]);
  });
});
