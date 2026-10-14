// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentViewer } from "./content-viewer";
import { BubblePart } from "./chat/part-content";
import { PartRenderer } from "./PartRenderer";

vi.mock("@/hooks/use-media-query", () => ({ useIsDesktop: () => true }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function choose(view: string) {
  const select = container.querySelector("select")!;
  await act(async () => {
    select.value = view;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("shared content viewer", () => {
  it("suggests Markdown without changing the source, and permits a local override", async () => {
    const part = Object.freeze({ id: "p", kind: "text" as const, mediaType: "text/plain", value: "**done**" });
    await act(async () => root.render(<BubblePart part={part} onUser />));
    expect(container.textContent).toContain("Markdown suggested");
    expect(container.querySelector("strong")).toBeNull();
    await choose("markdown");
    expect(container.querySelector("strong")?.textContent).toBe("done");
    expect(container.textContent).toContain("Sent as text/plain");
    expect(container.querySelector("select")?.value).toBe("markdown");
    expect(part.value).toBe("**done**");
    expect(part.mediaType).toBe("text/plain");
    await choose("text");
    expect(container.textContent).toContain("**done**");
  });

  it("sanitizes HTML inline only after explicit selection", async () => {
    await act(async () => root.render(<ContentViewer text={'<p onclick="alert(1)" style="position:fixed">Hello</p><script>alert(1)</script>'} mediaType="text/html" />));
    expect(container.querySelector("p")).toBeNull();
    await choose("html");
    expect(container.querySelector("p")?.outerHTML).toBe("<p>Hello</p>");
    expect(container.querySelector("script")).toBeNull();
  });

  it("opens rich HTML in a modal with an empty sandbox and restricted CSP", async () => {
    await act(async () => root.render(<ContentViewer text="<style>p{color:red}</style><p>Hello</p>" />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Rich HTML preview"]')!.click());
    const frame = document.querySelector("iframe")!;
    expect(frame).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.srcdoc).toContain("script-src 'none'");
    expect(frame.srcdoc).toContain("<style>p{color:red}</style>");
  });

  it("retains the selected mode across streaming updates and falls back safely for incomplete JSON", async () => {
    await act(async () => root.render(<ContentViewer text={'{"answer":1}'} />));
    await choose("json");
    await act(async () => root.render(<ContentViewer text={'{"answer":'} />));
    expect(container.querySelector("select")?.value).toBe("text");
    expect(container.querySelector('button[aria-label="Rich HTML preview"]')).toBeNull();
    await act(async () => root.render(<ContentViewer text={'{"answer":2}'} />));
    expect(container.querySelector("select")?.value).toBe("json");
  });

  it("uses common controls for sent data and received parts, preserving JSON tables", () => {
    const part = { id: "data", kind: "data" as const, mediaType: "application/json", value: [{ name: "report" }] };
    for (const element of [<BubblePart key="sent" part={part} onUser />, <BubblePart key="received" part={part} />, <PartRenderer key="status" part={part} allowRaw />]) {
      const html = renderToStaticMarkup(element);
      expect(html).toContain("Content view");
      expect(html).toContain("Sanitized HTML");
      expect(html).not.toContain('aria-label="Rich HTML preview"');
      expect(html).toContain("<table");
    }
  });

  it("suppresses remote Markdown images for sent and received messages", () => {
    const part = { id: "image", kind: "text" as const, mediaType: "text/markdown", value: "![remote](https://evil.test/pixel)" };
    expect(renderToStaticMarkup(<BubblePart part={part} onUser />)).not.toContain("<img");
    expect(renderToStaticMarkup(<BubblePart part={part} />)).not.toContain("<img");
  });

  it("keeps content before a compact shared-control footer without repeated view labels", async () => {
    await act(async () => root.render(<ContentViewer text="Hello" />));
    const footer = container.querySelector('[aria-label="Content format"]')!;
    expect(footer.previousElementSibling?.textContent).toBe("Hello");
    expect(footer.querySelector('[data-slot="native-select"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Current:");
    expect(container.textContent).not.toContain("Viewing as");
    expect(container.querySelector('button[aria-label="Rich HTML preview"]')).toBeNull();
  });

  it("handles an empty data value without passing undefined to the detector", () => {
    expect(() => renderToStaticMarkup(<PartRenderer part={{ id: "empty", kind: "data", mediaType: "application/json", value: undefined }} />)).not.toThrow();
  });
});