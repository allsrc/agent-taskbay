import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentBubble } from "@/components/chat/timeline";
import { STRUCTURED_FORM_EXTENSION_URI, STRUCTURED_FORM_MEDIA_TYPE } from "@/lib/structured-form";
import type { ThreadMessage } from "@/store/task-store";

const form = { title: "Deploy <b>now</b>", schema: { type: "object", required: ["env"], properties: {
  env: { type: "string", title: "Environment", enum: ["staging", "prod"] }, replicas: { type: "integer", minimum: 1 } } } };
const message = { id: "m1", role: "agent", fromStatus: true, parts: [
  { id: "t", kind: "text", value: "Which environment?", mediaType: "text/plain" },
  { id: "d", kind: "data", value: form, mediaType: STRUCTURED_FORM_MEDIA_TYPE }] } as unknown as ThreadMessage;
const render = (props: Partial<Parameters<typeof AgentBubble>[0]>) =>
  renderToStaticMarkup(<AgentBubble message={message} taskState="TASK_STATE_INPUT_REQUIRED" onSubmitForm={() => undefined} {...props} />);

describe("structured form in an input-required message", () => {
  it("renders an accessible form with escaped text when the agent advertised the extension", () => {
    const html = render({ extensions: [STRUCTURED_FORM_EXTENSION_URI] });
    expect(html).toContain('data-testid="structured-form"');
    expect(html).toMatch(/<label[^>]*>Environment/);
    expect(html).toContain("<select");
    expect(html).toContain("Deploy &lt;b&gt;now&lt;/b&gt;");
    expect(html).not.toContain("<b>now</b>");
    expect(html).toContain("Which environment?");
  });
  it("falls back to the generic data rendering when the extension is not advertised, answered, or the task is not waiting", () => {
    expect(render({ extensions: [] })).not.toContain("structured-form");
    expect(render({ extensions: [STRUCTURED_FORM_EXTENSION_URI], answered: true })).not.toContain("structured-form");
    expect(render({ extensions: [STRUCTURED_FORM_EXTENSION_URI], taskState: "TASK_STATE_WORKING" })).not.toContain("structured-form");
  });
});
