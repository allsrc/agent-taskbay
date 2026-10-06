import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { A2uiSurfaces } from "@/components/a2ui/surface";
import { A2UI_BASIC_CATALOG_ID, surfacesFromParts } from "@/lib/a2ui";
import type { NormalizedPart } from "@/lib/types";

const part = (value: unknown[]): NormalizedPart => ({ id: "p", kind: "data", value, mediaType: "application/a2ui+json" });
const surface = [
  { version: "v0.9", createSurface: { surfaceId: "s", catalogId: A2UI_BASIC_CATALOG_ID } },
  { version: "v0.9", updateComponents: { surfaceId: "s", components: [
    { id: "root", component: "Column", children: ["t", "x", "f", "ok", "bad", "img", "loop", "tpl"] },
    { id: "t", component: "Text", variant: "h3", text: "<img src=x onerror=alert(1)>" },
    { id: "x", component: "Text", text: { path: "/name" } },
    { id: "f", component: "TextField", label: "Reason", value: { path: "/reason" } },
    { id: "ok", component: "Button", child: "okl", action: { event: { name: "go" } } },
    { id: "okl", component: "Text", text: "Go" },
    { id: "bad", component: "Button", child: "okl", action: { functionCall: { call: "openUrl", args: { url: "javascript:alert(1)" } } } },
    { id: "img", component: "Image", url: "https://evil.example/pixel.png" },
    { id: "loop", component: "Card", child: "loop" },
    { id: "tpl", component: "Column", children: { path: "/items", componentId: "okl" } },
  ] } },
  { version: "v0.9", updateDataModel: { surfaceId: "s", path: "/", value: { name: "Jane", reason: "because" } } },
];
const render = (value: unknown[], interactive = true) => renderToStaticMarkup(<A2uiSurfaces state={surfacesFromParts([part(value)])} interactive={interactive} onAction={() => undefined} />);

describe("A2UI surface renderer", () => {
  const html = render(surface);
  it("renders text as text, resolves bindings and loads nothing external", () => {
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("evil.example");
    expect(html).toContain("Jane");
    expect(html).toContain('value="because"');
    expect(html).toContain("Interface described by the agent");
  });
  it("degrades unsupported components, templates, function-call actions and cycles to inert placeholders", () => {
    expect(html).toContain("Unsupported component “Image”");
    expect(html).toContain("Unsupported children");
    expect(html).toContain("Component skipped (nesting)");
    expect(html).not.toContain("javascript:");
    // The openUrl button is disabled and explains why; the event button is enabled.
    expect(html.match(/<button[^>]*disabled=""[^>]*title="This action is not supported"/g)).toHaveLength(1);
    expect(html.match(/<button(?![^>]*disabled="")[^>]*>/g)).toHaveLength(1);
  });
  it("is read-only once the task is no longer waiting", () => {
    const finished = render(surface, false);
    expect(finished).not.toMatch(/<button(?![^>]*disabled="")/);
    expect(finished).toMatch(/<input[^>]*disabled=""/);
  });
  it("refuses a catalog it does not implement and notes ignored updates", () => {
    expect(render([{ version: "v0.9", createSurface: { surfaceId: "s", catalogId: "https://example.com/own.json" } }])).toContain("catalog this console does not render");
    expect(render([{ nope: true }, ...surface])).toContain("1 invalid interface update ignored.");
    expect(render([{ version: "v0.9", createSurface: { surfaceId: "s", catalogId: A2UI_BASIC_CATALOG_ID } }])).toContain("Waiting for the agent");
  });
});
