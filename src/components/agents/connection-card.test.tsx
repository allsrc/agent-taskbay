import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectionCard } from "./connection-card";
import { OptionsPanel, type OptionsPanelProps } from "@/components/chat/options-panel";
import type { ConnectionView } from "@/lib/connection-interface";

const connection = (extra: Partial<ConnectionView> = {}): ConnectionView => ({
  binding: "JSONRPC", interfaceUrl: "https://agent.test/a2a", protocolVersion: "1.0", tenant: "", tenants: [], pinned: false,
  negotiated: [], ignored: [], required: [], unsupportedRequired: [], ...extra,
});
const render = (extra: Partial<ConnectionView> = {}) => renderToStaticMarkup(<ConnectionCard connection={connection(extra)} bindings={["JSONRPC"]} />);

// The repository has no browser test environment, so these check what the card and the selector show.
describe("ConnectionCard", () => {
  it("shows the interface, version and the default tenant label", () => {
    const html = render();
    expect(html).toContain("https://agent.test/a2a");
    expect(html).toContain("1.0");
    expect(html).toContain("(default)");
    expect(html).not.toContain("<a ");
  });

  it("says when the connection settings pin the interface", () => {
    expect(render({ pinned: true })).toContain("Pinned by your connection settings.");
    expect(render()).not.toContain("Pinned by your connection settings.");
  });

  it("lists every tenant and points at the chat options when there are several", () => {
    const html = render({ tenant: "acme", tenants: ["acme", "beta"] });
    expect(html).toContain("2 tenants: acme, beta");
    expect(html).toContain("chat options");
  });

  it("labels each extension and shows the required-but-unsupported pill", () => {
    const html = render({ negotiated: ["urn:n"], ignored: ["urn:i"], required: ["urn:r"], unsupportedRequired: ["urn:r"] });
    expect(html).toContain("1 negotiated · 1 ignored · 1 required, not supported");
    expect(html).toContain("1 not supported");
    for (const label of ["negotiated", "ignored", "required, not supported"]) expect(html).toContain(label);
  });

  it("renders agent-supplied URIs as text, not links", () => {
    const html = render({ interfaceUrl: "https://x.test/<b>", ignored: ["https://evil.test/ext"] });
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<b>");
  });
});

describe("OptionsPanel tenant selector", () => {
  const panel = (tenant?: OptionsPanelProps["tenant"]) => renderToStaticMarkup(
    <OptionsPanel returnImmediately={false} onReturnImmediately={() => undefined} historyLength="" onHistoryLength={() => undefined} outputModes={[]}
      declaredOutputModes={[]} onOutputModes={() => undefined} tasks={[]} refIds={[]} onRefIds={() => undefined} tenant={tenant} />);

  it("offers every tenant for a new conversation", () => {
    const html = panel({ options: ["acme", "beta"], value: "acme", onChange: () => undefined, locked: false });
    expect(html).toContain("<option value=\"acme\"");
    expect(html).toContain("<option value=\"beta\"");
    expect(html).not.toContain('disabled=""');
  });

  it("locks the tenant of an existing conversation", () => {
    const html = panel({ options: ["acme", "beta"], value: "beta", onChange: () => undefined, locked: true });
    expect(html).toContain('disabled=""');
    expect(html).toContain("keeps the tenant it started with");
  });

  it("is absent when the agent has at most one tenant", () => {
    expect(panel()).not.toContain("Tenant");
  });
});
