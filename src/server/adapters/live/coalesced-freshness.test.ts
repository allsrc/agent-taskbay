import { describe, expect, it, vi } from "vitest";
import { CoalescedFreshnessReader } from "./coalesced-freshness";

describe("coalesced freshness reads", () => {
  it("shares in-flight and recent reads per organization and refreshes after the ttl", async () => {
    let clock = 0;
    let token = "a";
    const source = { readToken: vi.fn(async () => token) };
    const reader = new CoalescedFreshnessReader(source, 400, () => clock);
    const first = await Promise.all(Array.from({ length: 100 }, () => reader.readToken("one")));
    expect(new Set(first)).toEqual(new Set(["a"]));
    expect(source.readToken).toHaveBeenCalledTimes(1);
    token = "b"; clock = 399;
    expect(await reader.readToken("one")).toBe("a");
    await reader.readToken("two");
    expect(source.readToken).toHaveBeenCalledTimes(2);
    clock = 400;
    expect(await reader.readToken("one")).toBe("b");
    expect(source.readToken).toHaveBeenCalledTimes(3);
  });

  it("does not cache failures", async () => {
    const source = { readToken: vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue("ok") };
    const reader = new CoalescedFreshnessReader(source, 400, () => 0);
    await expect(Promise.all([reader.readToken("one"), reader.readToken("one")])).rejects.toThrow("down");
    expect(await reader.readToken("one")).toBe("ok");
    expect(source.readToken).toHaveBeenCalledTimes(2);
  });
});
