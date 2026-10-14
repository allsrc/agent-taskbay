// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonTree } from "@/components/JsonTree";
import { ContentViewer, DataTable } from "@/components/content-viewer";
import { measure } from "@/components/long-content";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const file = Array.from({ length: 700 }, (_, index) => `line ${index + 1}`).join("\n");
let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

const button = (text: string) => [...container.querySelectorAll("button")].find((element) => element.textContent?.includes(text));

describe("long content", () => {
  it("measures by lines and characters, with a smaller limit for compact places", () => {
    expect(measure("short", "normal").long).toBe(false);
    expect(measure(file, "normal")).toMatchObject({ lines: 700, long: true });
    expect(measure("a\nb\nc\nd\ne\nf\ng", "compact").long).toBe(true);
    expect(measure("x".repeat(3000), "normal").long).toBe(true);
  });

  it("folds long text with a toggle, keeps all of it in the page, and leaves short text alone", async () => {
    await act(async () => root.render(<ContentViewer text={file} />));
    expect(container.querySelector("[data-clamped]")).not.toBeNull();
    expect(container.textContent).toContain("line 700");
    await act(async () => button("Show all 700 lines")!.click());
    expect(container.querySelector("[data-clamped]")).toBeNull();
    expect(button("Show less")).toBeTruthy();
    expect(renderToStaticMarkup(<ContentViewer text="Short." />)).not.toContain("Show all");
  });

  it("can fold sooner in compact places, or never", () => {
    expect(renderToStaticMarkup(<ContentViewer text={"1\n2\n3\n4\n5\n6\n7\n8"} clamp="compact" />)).toContain("Show all 8 lines");
    expect(renderToStaticMarkup(<ContentViewer text={file} clamp="none" />)).not.toContain("Show all");
  });

  it("keeps the line breaks of a long string inside JSON, folded", () => {
    const html = renderToStaticMarkup(<JsonTree value={{ response: { content: file } }} />);
    expect(html).toContain("<pre");
    expect(html).toContain("Show all 700 lines");
    expect(renderToStaticMarkup(<JsonTree value={{ name: "cat" }} />)).not.toContain("<pre");
  });

  it("pages large arrays and tables", async () => {
    const items = Array.from({ length: 250 }, (_, index) => index);
    expect(renderToStaticMarkup(<JsonTree value={items} />)).toContain("Show 150 more of 150");
    await act(async () => root.render(<DataTable rows={items.map((id) => ({ id }))} />));
    expect(container.querySelectorAll("tbody tr")).toHaveLength(100);
    await act(async () => button("more of 150 rows")!.click());
    expect(container.querySelectorAll("tbody tr")).toHaveLength(250);
  });
});
