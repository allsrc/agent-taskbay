import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "./clipboard";

afterEach(() => vi.unstubAllGlobals());

describe("copyToClipboard", () => {
  it("uses the clipboard API when it exists", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyToClipboard("abc")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("abc");
  });

  it("falls back to a hidden text area where the API is missing, as on a console served over plain HTTP", async () => {
    const area = { value: "", style: { cssText: "" }, setAttribute: vi.fn(), select: vi.fn(), setSelectionRange: vi.fn(), remove: vi.fn() };
    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", { createElement: () => area, body: { appendChild: vi.fn() }, execCommand, activeElement: null });
    expect(await copyToClipboard("a-very-long-id")).toBe(true);
    expect(area.value).toBe("a-very-long-id");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(area.remove).toHaveBeenCalled();
  });

  it("falls back when the API rejects, and reports failure when nothing works", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    vi.stubGlobal("document", { createElement: () => ({ style: {}, setAttribute() {}, select() {}, setSelectionRange() {}, remove() {} }), body: { appendChild() {} }, execCommand: () => false, activeElement: null });
    expect(await copyToClipboard("abc")).toBe(false);
  });

  it("reports failure when there is no document", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", undefined);
    expect(await copyToClipboard("abc")).toBe(false);
  });
});
