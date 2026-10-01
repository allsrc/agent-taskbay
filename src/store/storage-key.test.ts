import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateBrowserStorageKey } from "./storage-key";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("migrateBrowserStorageKey", () => {
  it("copies legacy state when the current key is absent", () => {
    const localStorage = memoryStorage({ legacy: "persisted" });
    vi.stubGlobal("window", { localStorage });

    migrateBrowserStorageKey("legacy", "current");

    expect(localStorage.getItem("legacy")).toBe("persisted");
    expect(localStorage.getItem("current")).toBe("persisted");
  });

  it("does not overwrite state already stored under the current key", () => {
    const localStorage = memoryStorage({ legacy: "old", current: "new" });
    vi.stubGlobal("window", { localStorage });

    migrateBrowserStorageKey("legacy", "current");

    expect(localStorage.getItem("current")).toBe("new");
  });
});
