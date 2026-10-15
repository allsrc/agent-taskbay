import { describe, expect, it } from "vitest";
import { effectiveTaskDiscovery, isTaskDiscoveryMode } from "./discovery-mode";
import { taskDiscoveryCap } from "../runtime/runtime-config";

describe("effectiveTaskDiscovery", () => {
  it.each([["auto", "browse", "browse"], ["browse", "off", "off"], ["off", "auto", "off"], ["auto", "auto", "auto"], ["browse", "auto", "browse"], ["off", "off", "off"]] as const)(
    "agent %s under cap %s is %s", (agent, cap, expected) => expect(effectiveTaskDiscovery(agent, cap)).toBe(expected));
  it("recognizes only the three modes", () => {
    expect(["off", "browse", "auto"].every(isTaskDiscoveryMode)).toBe(true);
    for (const value of ["on", "", "AUTO", undefined, 1]) expect(isTaskDiscoveryMode(value)).toBe(false);
  });
});

describe("A2A_TASK_DISCOVERY", () => {
  it("defaults to browse when unset or blank", () => {
    expect(taskDiscoveryCap({})).toBe("browse");
    expect(taskDiscoveryCap({ A2A_TASK_DISCOVERY: "  " })).toBe("browse");
  });
  it.each(["off", "browse", "auto"])("accepts %s", (value) => expect(taskDiscoveryCap({ A2A_TASK_DISCOVERY: value })).toBe(value));
  it("fails with a message that names the variable and the allowed values", () => {
    expect(() => taskDiscoveryCap({ A2A_TASK_DISCOVERY: "true" })).toThrow(/A2A_TASK_DISCOVERY must be one of off, browse, auto/);
  });
});
