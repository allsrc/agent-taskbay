import { describe, expect, it } from "vitest";
import type { NormalizedPart } from "@/lib/types";
import { A2UI_BASIC_CATALOG_ID, A2UI_LIMITS, applyMessage, buildActionMessage, effectiveModel, getPointer, isA2uiPart, newA2uiState, parsePointer, readEvent, resolveValue, setPointer, surfacesFromParts } from "./a2ui";

const part = (value: unknown, mediaType = "application/a2ui+json", metadata?: Record<string, unknown>): NormalizedPart => ({ id: "p", kind: "data", value, mediaType, metadata });
const create = (surfaceId = "s1", catalogId = A2UI_BASIC_CATALOG_ID) => ({ version: "v0.9", createSurface: { surfaceId, catalogId } });
const update = (components: unknown[], surfaceId = "s1") => ({ version: "v0.9", updateComponents: { surfaceId, components } });
const data = (value: unknown, path?: string, surfaceId = "s1") => ({ version: "v0.9", updateDataModel: { surfaceId, ...(path === undefined ? {} : { path }), ...(value === undefined ? {} : { value }) } });

describe("A2UI part detection", () => {
  it("accepts both published media types, or the declared metadata mime type, but only arrays of envelopes", () => {
    expect(isA2uiPart(part([create()]))).toBe(true);
    expect(isA2uiPart(part([create()], "application/json+a2ui"))).toBe(true);
    expect(isA2uiPart(part([create()], "application/json", { mimeType: "application/a2ui+json" }))).toBe(true);
    expect(isA2uiPart(part([create()], "application/json"))).toBe(false);
    expect(isA2uiPart(part(create()))).toBe(false);
    expect(isA2uiPart({ ...part([create()]), kind: "text" })).toBe(false);
  });
});

describe("JSON pointers", () => {
  it("parses absolute pointers and refuses relative, oversized and prototype-polluting ones", () => {
    expect(parsePointer("/a/b~1c/d~0e")).toEqual(["a", "b/c", "d~e"]);
    expect(parsePointer("/")).toEqual([]);
    expect(parsePointer("relative")).toBeUndefined();
    expect(parsePointer("/__proto__/x")).toBeUndefined();
    expect(parsePointer("/a/constructor")).toBeUndefined();
    expect(parsePointer(`/${"a".repeat(600)}`)).toBeUndefined();
    expect(parsePointer(7)).toBeUndefined();
  });
  it("reads, writes and deletes without touching prototypes", () => {
    const model: Record<string, unknown> = { user: { name: "Jane" }, list: ["a", "b"] };
    expect(getPointer(model, "/user/name")).toBe("Jane");
    expect(getPointer(model, "/list/1")).toBe("b");
    expect(getPointer(model, "/user/toString")).toBeUndefined();
    expect(setPointer(model, "/user/email", "j@x")).toBe(true);
    expect(setPointer(model, "/deep/er/path", 1)).toBe(true);
    expect(model).toMatchObject({ user: { email: "j@x" }, deep: { er: { path: 1 } } });
    expect(setPointer(model, "/user/name", undefined)).toBe(true);
    expect((model.user as Record<string, unknown>).name).toBeUndefined();
    expect(setPointer(model, "/__proto__/polluted", true)).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(setPointer(model, "/user/name/x", 1)).toBe(true); // name was deleted, so this creates it
    expect(setPointer(model, "/list/x", 1)).toBe(false);
  });
});

describe("A2UI surface state", () => {
  it("builds surfaces from createSurface, updateComponents and updateDataModel across parts", () => {
    const state = surfacesFromParts([
      part([create(), update([{ id: "root", component: "Column", children: ["t"] }, { id: "t", component: "Text", text: { path: "/title" } }]), data("Deploy", "/title")]),
      part([update([{ id: "t", component: "Text", text: "Replaced" }]), data({ a: 1 }, "/extra")]),
    ]);
    const surface = state.surfaces.get("s1")!;
    expect(surface.supported).toBe(true);
    expect([...surface.components.keys()]).toEqual(["root", "t"]);
    expect(surface.components.get("t")).toMatchObject({ text: "Replaced" });
    expect(surface.model).toEqual({ title: "Deploy", extra: { a: 1 } });
    expect(state.rejected).toBe(0);
  });
  it("marks an unknown catalog unsupported and deletes surfaces", () => {
    const state = newA2uiState();
    applyMessage(state, create("a", "https://example.com/other.json"));
    applyMessage(state, create("b"));
    expect(state.surfaces.get("a")!.supported).toBe(false);
    applyMessage(state, { version: "v0.9", deleteSurface: { surfaceId: "b" } });
    expect([...state.surfaces.keys()]).toEqual(["a"]);
  });
  it("skips invalid envelopes, counts them, and keeps applying the rest", () => {
    const state = newA2uiState();
    for (const bad of [null, "x", {}, { version: "v0.8", createSurface: { surfaceId: "s", catalogId: "c" } },
      { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "c" }, deleteSurface: { surfaceId: "s" } },
      { version: "v0.9", createSurface: { surfaceId: "", catalogId: "c" } }, { version: "v0.9", wipe: { surfaceId: "s" } },
      update([{ id: "root", component: "Text" }], "missing"), data(1, "/a", "missing")]) applyMessage(state, bad);
    applyMessage(state, create());
    for (const bad of [update([]), update([{ id: "x" }]), update([{ component: "Text" }]), data("v", "relative"), data(1, "/__proto__/x"), data([1], "/")]) applyMessage(state, bad);
    expect(state.rejected).toBe(15);
    expect(state.surfaces.size).toBe(1);
    expect(state.surfaces.get("s1")!.components.size).toBe(0);
  });
  it("enforces component, surface and data-model limits", () => {
    const state = newA2uiState();
    applyMessage(state, create());
    applyMessage(state, update(Array.from({ length: A2UI_LIMITS.components + 1 }, (_, i) => ({ id: `c${i}`, component: "Divider" }))));
    expect(state.surfaces.get("s1")!.components.size).toBe(0);
    applyMessage(state, data({ big: "x".repeat(A2UI_LIMITS.modelBytes) }, "/"));
    expect(state.surfaces.get("s1")!.model).toEqual({});
    for (let i = 0; i < A2UI_LIMITS.surfaces + 3; i++) applyMessage(state, create(`extra${i}`));
    expect(state.surfaces.size).toBe(A2UI_LIMITS.surfaces);
  });
  it("layers the viewer's input over the agent's model without changing it", () => {
    const surface = surfacesFromParts([part([create(), data({ reason: "agent" }, "/")])]).surfaces.get("s1")!;
    expect(effectiveModel(surface, [["/reason", "mine"], ["/notify", true]])).toEqual({ reason: "mine", notify: true });
    expect(surface.model).toEqual({ reason: "agent" });
  });
});

describe("bindings and actions", () => {
  const model = { name: "Jane", n: 3 };
  it("resolves literals and absolute paths only; functions and relative paths are unsupported", () => {
    expect(resolveValue("hi", model)).toBe("hi");
    expect(resolveValue({ path: "/name" }, model)).toBe("Jane");
    expect(resolveValue({ path: "name" }, model)).toBeUndefined();
    expect(resolveValue({ call: "formatString", args: { value: "x" } }, model)).toBeUndefined();
    expect(resolveValue([1], model)).toBeUndefined();
  });
  it("reads only server events, resolving context from the model", () => {
    expect(readEvent({ event: { name: "go", context: { who: { path: "/name" }, fixed: 1, missing: { path: "/nope" } } } }, model)).toEqual({ name: "go", context: { who: "Jane", fixed: 1 } });
    expect(readEvent({ functionCall: { call: "openUrl", args: { url: "https://evil.example" } } }, model)).toBeUndefined();
    expect(readEvent({ event: { name: "go" }, functionCall: { call: "openUrl" } }, model)).toBeUndefined();
    expect(readEvent({ event: { name: "" } }, model)).toBeUndefined();
    expect(readEvent({ event: { name: "go", context: "x" } }, model)).toBeUndefined();
    expect(readEvent({ event: { name: "go", context: { big: "x".repeat(A2UI_LIMITS.contextBytes) } } }, model)).toBeUndefined();
  });
  it("builds the action envelope the extension specifies", () => {
    expect(buildActionMessage("s1", "btn", { name: "go", context: { a: 1 } }, new Date("2026-10-05T12:00:00Z"))).toEqual({
      version: "v0.9", action: { name: "go", surfaceId: "s1", sourceComponentId: "btn", timestamp: "2026-10-05T12:00:00.000Z", context: { a: 1 } } });
  });
});
