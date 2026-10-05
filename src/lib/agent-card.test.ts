import { describe, expect, it } from "vitest";
import { agentBadge, viewAgentCard } from "./agent-card";

describe("viewAgentCard", () => {
  it("reads a v1.0 card", () => {
    const view = viewAgentCard({
      name: "Architecture Review Agent",
      version: "1.4.0",
      supportedInterfaces: [
        { url: "https://a/a2a", protocolBinding: "JSONRPC", tenant: "arch-prod" },
        { url: "https://a/a2a", protocolBinding: "GRPC" },
      ],
      capabilities: { streaming: true, pushNotifications: true },
      securitySchemes: { oauth: { oauth2SecurityScheme: {} }, key: { apiKeySecurityScheme: {} } },
      defaultInputModes: ["text/markdown"],
      skills: [{ id: "s", name: "security-review", description: "d", examples: ["Review it"] }],
    });
    expect(view.bindings).toEqual(["JSONRPC", "GRPC"]);
    expect(view.tenant).toBe("arch-prod");
    expect(view.streaming && view.pushNotifications && !view.extendedCard).toBe(true);
    expect(view.security).toEqual(["OAuth 2.0", "API key"]);
    expect(view.skills[0].examples).toEqual(["Review it"]);
  });

  it("keeps extension URIs and only object params", () => {
    const view = viewAgentCard({ capabilities: { extensions: [{ uri: "https://x/a", params: { startForm: { title: "T" } } }, { uri: "https://x/b", params: "nope" }, { uri: "https://x/c" }, { params: {} }] } });
    expect(view.extensions).toEqual(["https://x/a", "https://x/b", "https://x/c"]);
    expect(view.extensionParams).toEqual({ "https://x/a": { startForm: { title: "T" } } });
  });

  it("tolerates an empty or legacy card", () => {
    expect(viewAgentCard(undefined).name).toBe("Unnamed agent");
    expect(viewAgentCard({ name: "Old", url: "https://x", preferredTransport: "JSONRPC" }).bindings).toEqual(["JSONRPC"]);
  });
});

describe("agentBadge", () => {
  it("builds initials and a stable colour", () => {
    expect(agentBadge("Flight Agent", "x").short).toBe("FA");
    expect(agentBadge("Flight Agent", "x").color).toBe(agentBadge("Flight Agent", "x").color);
    expect(agentBadge("planner", "y").short).toBe("PL");
  });
});
