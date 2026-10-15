import { describe, expect, it } from "vitest";
import { advertisedTenants, buildConnectionView, chooseConnectionInterface, defaultTenant, type InterfaceLike } from "./connection-interface";

const rpc = (extra: Partial<InterfaceLike> = {}): InterfaceLike => ({ url: "https://a.test/rpc", protocolBinding: "JSONRPC", protocolVersion: "1.0", ...extra });
const rest = (extra: Partial<InterfaceLike> = {}): InterfaceLike => ({ url: "https://a.test/rest", protocolBinding: "HTTP+JSON", protocolVersion: "1.0", ...extra });
const none = { advertised: [], negotiated: [], required: [], unsupportedRequired: [] };

describe("chooseConnectionInterface", () => {
  const grpc = { url: "https://a.test/grpc", protocolBinding: "GRPC", protocolVersion: "1.0" };
  const older = rpc({ protocolVersion: "0.3.0", url: "https://a.test/old" });
  const cases: Array<[string, InterfaceLike[], Parameters<typeof chooseConnectionInterface>[1], string | undefined, boolean]> = [
    ["first usable interface in card order", [rpc()], {}, "https://a.test/rpc", false],
    ["never gRPC", [grpc, rpc()], {}, "https://a.test/rpc", false],
    ["only gRPC offers nothing", [grpc], {}, undefined, false],
    ["prefers the 1.0 interface over an older one of the same binding", [older, rpc()], {}, "https://a.test/rpc", false],
    ["a v0.3 card keeps its only interface", [older], {}, "https://a.test/old", false],
    ["pinned url", [rpc(), rest()], { interfaceUrl: "https://a.test/rest" }, "https://a.test/rest", true],
    ["pinned binding is case-insensitive", [rpc(), rest()], { protocolBinding: "http+json" }, "https://a.test/rest", true],
    ["pinned version picks the v0.3 interface", [older, rpc()], { protocolVersion: "0.3.0" }, "https://a.test/old", true],
    ["pin that is no longer advertised selects nothing", [rpc()], { interfaceUrl: "https://gone.test" }, undefined, true],
  ];
  it.each(cases)("%s", (_name, interfaces, pin, url, pinned) => {
    const choice = chooseConnectionInterface(interfaces, pin);
    expect(choice.selected?.url).toBe(url);
    expect(choice.pinned).toBe(pinned);
  });
});

describe("tenants", () => {
  it("lists distinct tenants in card order and ignores gRPC and empty ones", () => {
    expect(advertisedTenants([rpc({ tenant: "acme" }), rpc({ tenant: "beta" }), rest({ tenant: "acme" }), rpc()])).toEqual(["acme", "beta"]);
    expect(advertisedTenants([{ ...rpc({ tenant: "grpc-only" }), protocolBinding: "GRPC" }])).toEqual([]);
  });
  it("uses the only tenant, none when there is none, and the selected interface's when several", () => {
    expect(defaultTenant([])).toBe("");
    expect(defaultTenant(["acme"])).toBe("acme");
    expect(defaultTenant(["acme", "beta"], rpc({ tenant: "beta" }))).toBe("beta");
    expect(defaultTenant(["acme", "beta"], rpc())).toBe("acme");
  });
});

describe("buildConnectionView", () => {
  it("describes an unpinned single-tenant connection", () => {
    const view = buildConnectionView([rpc({ tenant: "acme" })], {}, none);
    expect(view).toMatchObject({ binding: "JSONRPC", interfaceUrl: "https://a.test/rpc", protocolVersion: "1.0", tenant: "acme", tenants: ["acme"], pinned: false });
  });
  it("marks a pinned connection and lists every tenant", () => {
    const view = buildConnectionView([rpc({ tenant: "acme" }), rpc({ tenant: "beta" })], { protocolBinding: "JSONRPC" }, none);
    expect(view.pinned).toBe(true);
    expect(view.tenants).toEqual(["acme", "beta"]);
  });
  it("splits extensions into negotiated, ignored and required-but-unsupported", () => {
    const view = buildConnectionView([rpc()], {}, {
      advertised: ["urn:a", "urn:b", "urn:c"], negotiated: ["urn:a"], required: ["urn:c"], unsupportedRequired: ["urn:c"],
    });
    expect(view).toMatchObject({ negotiated: ["urn:a"], ignored: ["urn:b"], required: ["urn:c"], unsupportedRequired: ["urn:c"] });
  });
  it("reports nothing selected when no interface is usable", () => {
    expect(buildConnectionView([], {}, none)).toMatchObject({ binding: null, interfaceUrl: null, protocolVersion: null, tenant: "", tenants: [] });
  });
});
