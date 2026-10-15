import { describe, expect, it } from "vitest";
import { requiredExtensionUris, understoodExtensionUris, unsupportedRequiredExtensionUris } from "./extension";
import { validateAgentCard } from "../../lib/compliance";
import { A2UI_EXTENSION_URI } from "../../lib/a2ui";

const card = (...extensions: Array<Record<string, unknown>>) => ({ capabilities: { extensions } });
const unknown = "https://example.test/extensions/needed/v1";

describe("required extensions", () => {
  it("lists only extensions marked required", () => {
    expect(requiredExtensionUris(card({ uri: unknown, required: true }, { uri: "https://example.test/optional", required: false }, { uri: "https://example.test/default" }))).toEqual([unknown]);
  });
  it("does not flag a required extension Taskbay understands", () => {
    expect(unsupportedRequiredExtensionUris(card({ uri: A2UI_EXTENSION_URI, required: true }))).toEqual([]);
    for (const uri of understoodExtensionUris()) expect(unsupportedRequiredExtensionUris(card({ uri, required: true }))).toEqual([]);
  });
  it("flags a required extension Taskbay does not understand, and honors a custom list", () => {
    expect(unsupportedRequiredExtensionUris(card({ uri: unknown, required: true }))).toEqual([unknown]);
    expect(unsupportedRequiredExtensionUris(card({ uri: unknown, required: true }), [unknown])).toEqual([]);
  });
  it("ignores malformed cards and entries", () => {
    for (const value of [undefined, null, {}, { capabilities: {} }, { capabilities: { extensions: "x" } }, card({ required: true }, { uri: 5, required: true })]) {
      expect(requiredExtensionUris(value)).toEqual([]);
    }
  });
  it("adds an error to the compliance report only when asked to check", () => {
    const base = { name: "A", description: "d", version: "1", supportedInterfaces: [{ url: "https://a.test", protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
      skills: [{ id: "s", name: "s", description: "s", tags: [] }], defaultInputModes: ["text/plain"], defaultOutputModes: ["text/plain"], ...card({ uri: unknown, required: true }) };
    expect(validateAgentCard(base).issues.some((issue) => issue.id === "extension.required.unsupported")).toBe(false);
    const checked = validateAgentCard(base, { understoodExtensions: understoodExtensionUris() });
    expect(checked.issues.find((issue) => issue.id === "extension.required.unsupported")).toMatchObject({ severity: "error" });
    expect(validateAgentCard(base, { understoodExtensions: [unknown] }).issues.some((issue) => issue.id === "extension.required.unsupported")).toBe(false);
  });
});
