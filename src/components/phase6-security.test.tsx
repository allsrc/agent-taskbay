import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { A2uiSurfaces } from "@/components/a2ui/surface";
import { ProposedActionView } from "@/components/approvals/proposed-action";
import { StructuredForm } from "@/components/chat/structured-form";
import { A2UI_BASIC_CATALOG_ID, A2UI_LIMITS, surfacesFromParts } from "@/lib/a2ui";
import { parseFormDefinition } from "@/lib/structured-form";
import type { NormalizedPart } from "@/lib/types";

/**
 * Phase 6 exit criterion: generated UI cannot run code. Hostile agent content goes through every Phase 6 renderer; the markup must
 * contain no executable or loading construct at all (no script, event-handler attribute, link, source, frame, style or embedded media).
 */
const EVIL = `<script>window.__pwned=1</script><img src=x onerror=window.__pwned=1><svg onload=window.__pwned=1><a href="javascript:window.__pwned=1">x</a>"'><iframe srcdoc="<script>1</script>">`;
const FORBIDDEN: Array<[string, RegExp]> = [
  ["a script element", /<script/i], ["an event-handler attribute", /\son[a-z]+\s*=/i], ["a link target", /\shref\s*=/i], ["a source attribute", /\ssrcdoc?\s*=/i],
  ["a javascript: URL", /javascript:/i], ["a frame or embed", /<(iframe|object|embed|frame)/i], ["document metadata or style", /<(link|meta|style|base)\b/i],
  ["inline style from content", /\sstyle\s*=/i], ["embedded media or image", /<(img|video|audio|svg|canvas|picture|source)\b/i], ["an anchor", /<a\s/i], ["a form action", /\saction\s*=/i],
];
// Only real tags count: hostile strings are rendered as escaped text (no `<` survives), so tag text is the executable surface.
const assertInert = (html: string, label: string) => {
  // Attribute values are quoted and escaped (hostile text can sit in an aria-label); what could execute is the tag and attribute names.
  const markup = (html.match(/<[a-zA-Z/][^>]*>/g) ?? []).map((tag) => tag.replace(/="[^"]*"/g, '=""')).join("\n");
  expect(markup.length, `${label}: renders some markup`).toBeGreaterThan(0);
  for (const [name, pattern] of FORBIDDEN) expect(markup, `${label}: ${name}`).not.toMatch(pattern);
  expect(html.replace(/<[a-zA-Z/][^>]*>/g, ""), `${label}: no raw angle bracket outside tags`).not.toMatch(/</);
};
const part = (value: unknown[]): NormalizedPart => ({ id: "p", kind: "data", value, mediaType: "application/a2ui+json" });
const render = (messages: unknown[], interactive = true) => renderToStaticMarkup(<A2uiSurfaces state={surfacesFromParts([part(messages)])} interactive={interactive} onAction={() => undefined} />);

describe("Phase 6 renderers never produce executable or loading markup from agent content", () => {
  it("A2UI: hostile text in every text-bearing property, hostile URLs and attribute-like properties", () => {
    const html = render([
      { version: "v0.9", createSurface: { surfaceId: `s"><script>1</script>`, catalogId: A2UI_BASIC_CATALOG_ID, theme: { primaryColor: "red;background:url(javascript:1)" } } },
      { version: "v0.9", updateComponents: { surfaceId: `s"><script>1</script>`, components: [
        { id: "root", component: "Column", className: "pwn", style: "x", dangerouslySetInnerHTML: { __html: EVIL }, children: ["t", "f", "c", "p", "b", "i", "v", "a", "m", "l", "d", EVIL] },
        { id: "t", component: "Text", text: EVIL, variant: EVIL, onClick: "x" },
        { id: "f", component: "TextField", label: EVIL, value: { path: "/x" }, variant: EVIL, validationRegexp: "(a+)+$", onChange: "x" },
        { id: "c", component: "CheckBox", label: EVIL, value: { path: "/y" } },
        { id: "p", component: "ChoicePicker", label: EVIL, value: { path: "/z" }, options: [{ label: EVIL, value: EVIL }, { label: { path: "/x" }, value: "ok" }] },
        { id: "b", component: "Button", child: "bt", action: { event: { name: EVIL, context: { x: { path: "/x" } } } } },
        { id: "bt", component: "Text", text: EVIL },
        { id: "i", component: "Image", url: "javascript:window.__pwned=1" }, { id: "v", component: "Video", url: "https://evil.example/v.mp4" },
        { id: "a", component: "AudioPlayer", url: "data:text/html,<script>1</script>" },
        { id: "m", component: "Modal", trigger: "b", content: "t" },
        { id: "l", component: "Button", child: "bt", action: { functionCall: { call: "openUrl", args: { url: "javascript:window.__pwned=1" } } } },
        { id: "d", component: EVIL },
      ] } },
      { version: "v0.9", updateDataModel: { surfaceId: `s"><script>1</script>`, path: "/", value: { x: EVIL, y: true, z: [EVIL] } } },
    ]);
    expect(html).toContain("&lt;script&gt;");
    assertInert(html, "A2UI surface");
    assertInert(render([{ version: "v0.9", createSurface: { surfaceId: "s", catalogId: EVIL } }]), "A2UI foreign catalog");
  });

  it("A2UI: cycles, deep nesting and oversized trees are bounded, and prototype keys change nothing", () => {
    const deep = Array.from({ length: 60 }, (_, i) => ({ id: i === 0 ? "root" : `n${i}`, component: "Column", children: [`n${i + 1}`] }));
    const cyclic = [{ id: "root", component: "Card", child: "root" }];
    const big = Array.from({ length: A2UI_LIMITS.components + 50 }, (_, i) => ({ id: i === 0 ? "root" : `c${i}`, component: "Divider" }));
    for (const [label, components] of [["deep", deep], ["cyclic", cyclic], ["oversized", big]] as const) {
      const started = Date.now();
      const html = render([{ version: "v0.9", createSurface: { surfaceId: "s", catalogId: A2UI_BASIC_CATALOG_ID } }, { version: "v0.9", updateComponents: { surfaceId: "s", components } }]);
      expect(Date.now() - started, label).toBeLessThan(2_000);
      assertInert(html, label);
    }
    render([{ version: "v0.9", createSurface: { surfaceId: "s", catalogId: A2UI_BASIC_CATALOG_ID } },
      { version: "v0.9", updateDataModel: { surfaceId: "s", path: "/__proto__/polluted", value: true } },
      { version: "v0.9", updateDataModel: { surfaceId: "s", path: "/constructor/prototype/polluted", value: true } },
      { version: "v0.9", updateDataModel: { surfaceId: "s", value: JSON.parse('{"__proto__":{"polluted":true}}') } }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
  });

  it("structured forms: hostile titles, labels, descriptions, enum values and defaults render as text", () => {
    const form = parseFormDefinition({ title: EVIL, description: EVIL, submitLabel: EVIL, schema: { type: "object", required: ["a"], properties: {
      a: { type: "string", title: EVIL, description: EVIL, default: EVIL }, b: { type: "string", enum: [EVIL, "ok"], enumNames: [EVIL, EVIL] }, c: { type: "boolean", title: EVIL }, d: { type: "integer", title: EVIL } } } })!;
    expect(form).toBeDefined();
    const html = renderToStaticMarkup(<StructuredForm form={form} onSubmit={() => undefined} />);
    expect(html).toContain("&lt;script&gt;");
    assertInert(html, "structured form");
    // Keys that could be used as markup or prototype tricks are refused outright.
    for (const key of [EVIL, "__proto__", "a b", "on click"]) expect(parseFormDefinition({ schema: { type: "object", properties: { [key]: { type: "string" } } } })).toBeUndefined();
  });

  it("approval content: a proposed text or structured action shows as text on the review page", () => {
    const form = { title: EVIL, schema: { type: "object", properties: { a: { type: "string", title: EVIL } } } };
    assertInert(renderToStaticMarkup(<ProposedActionView action={{ kind: "send_message", text: EVIL, data: { x: EVIL } }} />), "text action");
    const structured = renderToStaticMarkup(<ProposedActionView action={{ kind: "send_data", form, values: { a: EVIL } }} />);
    expect(structured).toContain("&lt;script&gt;");
    assertInert(structured, "structured action");
  });
});
