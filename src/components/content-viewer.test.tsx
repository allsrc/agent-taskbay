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

const button = (label: string) =>
  [...container.querySelectorAll("button")].find((element) => element.textContent?.trim() === label || element.getAttribute("aria-label") === label);

async function click(element: Element | undefined | null) {
  expect(element).toBeTruthy();
  await act(async () => (element as HTMLElement).click());
}

/** Opens the content-view menu and picks a view by its label. */
async function choose(label: string) {
  await click(button("Content view"));
  const item = [...document.querySelectorAll('[role="menuitemradio"]')].find((element) => element.textContent?.startsWith(label));
  await click(item);
}

describe("shared content viewer", () => {
  it("shows no controls for an ordinary sentence", async () => {
    await act(async () => root.render(<ContentViewer text="Hello there." />));
    expect(container.textContent).toBe("Hello there.");
    expect(container.querySelector('[aria-label="Content format"]')).toBeNull();
  });

  it("keeps a person's own text as sent, offers formatting, and never changes the source", async () => {
    const part = Object.freeze({ id: "p", kind: "text" as const, mediaType: "text/plain", value: "**done**" });
    await act(async () => root.render(<BubblePart part={part} onUser />));
    expect(container.querySelector("strong")).toBeNull();
    await click(button("Format as Markdown"));
    expect(container.querySelector("strong")?.textContent).toBe("done");
    expect(part.value).toBe("**done**");
    expect(part.mediaType).toBe("text/plain");
    await click(button("Plain text"));
    expect(container.textContent).toContain("**done**");
  });

  it("formats an agent's Markdown sent as text/plain, with a way back to the plain text", async () => {
    const part = { id: "p", kind: "text" as const, mediaType: "text/plain", value: "**staging** had 14 deploys" };
    await act(async () => root.render(<BubblePart part={part} />));
    expect(container.querySelector("strong")?.textContent).toBe("staging");
    await click(button("Plain text"));
    expect(container.querySelector("strong")).toBeNull();
  });

  it("lists every view with the declared type in the menu", async () => {
    await act(async () => root.render(<ContentViewer text={"# Title\n\n- one"} mediaType="text/plain" />));
    await click(button("Content view"));
    const menu = document.querySelector('[role="menu"]')!;
    expect(menu.textContent).toContain("Sent as text/plain");
    expect(menu.textContent).toContain("Auto (Markdown)");
    expect(menu.textContent).toContain("Sanitized HTML");
  });

  it("sanitizes HTML inline only after explicit selection", async () => {
    await act(async () => root.render(<ContentViewer text={'<p onclick="alert(1)" style="position:fixed">Hello</p><script>alert(1)</script>'} mediaType="text/html" />));
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelector("pre")?.textContent).toContain("<p onclick");
    await choose("Sanitized HTML");
    expect(container.querySelector("p")?.outerHTML).toBe("<p>Hello</p>");
    expect(container.querySelector("script")).toBeNull();
  });

  it("opens rich HTML in a modal with an empty sandbox and restricted CSP", async () => {
    await act(async () => root.render(<ContentViewer text="<style>p{color:red}</style><p>Hello</p>" />));
    await click(button("Preview HTML"));
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
    await choose("JSON");
    expect(container.textContent).toContain("answer");
    await act(async () => root.render(<ContentViewer text={'{"answer":'} />));
    expect(container.textContent).toBe('{"answer":');
    await act(async () => root.render(<ContentViewer text={'{"answer":2}'} />));
    expect(container.textContent).not.toContain('{"answer":2}');
    expect(container.textContent).toContain("answer");
  });

  it("hides controls while text streams in", async () => {
    await act(async () => root.render(<ContentViewer text={"# Title"} streaming />));
    expect(container.querySelector('[aria-label="Content format"]')).toBeNull();
  });

  it("renders structured data as a table, not as text with format controls", () => {
    const part = { id: "data", kind: "data" as const, mediaType: "application/json", value: [{ name: "report" }] };
    for (const element of [<BubblePart key="sent" part={part} onUser />, <BubblePart key="received" part={part} />, <PartRenderer key="status" part={part} allowRaw />]) {
      const html = renderToStaticMarkup(element);
      expect(html).toContain("<table");
      expect(html).not.toContain("Sanitized HTML");
    }
  });

  it("suppresses remote Markdown images for sent and received messages", () => {
    const part = { id: "image", kind: "text" as const, mediaType: "text/markdown", value: "![remote](https://evil.test/pixel)" };
    expect(renderToStaticMarkup(<BubblePart part={part} onUser />)).not.toContain("<img");
    expect(renderToStaticMarkup(<BubblePart part={part} />)).not.toContain("<img");
  });

  it("handles an empty data value without passing undefined to the detector", () => {
    expect(() => renderToStaticMarkup(<PartRenderer part={{ id: "empty", kind: "data", mediaType: "application/json", value: undefined }} />)).not.toThrow();
  });
});
