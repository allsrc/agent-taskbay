// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStickToBottom } from "./use-stick-to-bottom";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let notifyResize: () => void = () => undefined;
class FakeResizeObserver {
  constructor(callback: () => void) { notifyResize = callback; }
  observe() {}
  disconnect() {}
}

let container: HTMLDivElement;
let root: Root;
const scrollTo = vi.fn();

function Chat() {
  const scroller = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const { follow } = useStickToBottom({ scroller, watch: [column] });
  return (
    <div>
      <div ref={scroller} data-testid="pane" style={{ overflowY: "auto" }}><div ref={column} /></div>
      <button type="button" onClick={follow}>Send</button>
    </div>
  );
}

function pane() {
  const element = container.querySelector<HTMLElement>('[data-testid="pane"]')!;
  // jsdom does not lay anything out, so the pane reports a fixed 500px view over 1000px of content.
  Object.defineProperties(element, { clientHeight: { value: 500, configurable: true }, scrollHeight: { value: 1000, configurable: true } });
  return element;
}

async function scrollUser(element: HTMLElement, top: number) {
  Object.defineProperty(element, "scrollTop", { value: top, configurable: true });
  await act(async () => element.dispatchEvent(new Event("scroll")));
}

beforeEach(async () => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  // jsdom has no Element.scrollTo; the hook scrolls the pane as soon as it mounts.
  HTMLElement.prototype.scrollTo = scrollTo as unknown as typeof HTMLElement.prototype.scrollTo;
  scrollTo.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Chat />));
  pane();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("stick to bottom", () => {
  it("follows content that grows after the first scroll", () => {
    scrollTo.mockClear();
    notifyResize();
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000 });
  });

  it("stops following when you scroll up to read, and resumes when you come back to the end", async () => {
    const element = pane();
    await scrollUser(element, 100);
    scrollTo.mockClear();
    notifyResize();
    expect(scrollTo).not.toHaveBeenCalled();
    await scrollUser(element, 460);
    notifyResize();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("jumps to the end and resumes following on follow(), for example after you send", async () => {
    await scrollUser(pane(), 0);
    scrollTo.mockClear();
    await act(async () => container.querySelector("button")!.click());
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000 });
    notifyResize();
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });
});
