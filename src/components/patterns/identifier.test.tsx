import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Identifier, IdentifierList } from "./identifier";

const render = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
const LONG = "ctx-" + "0123456789abcdef".repeat(20);

describe("Identifier", () => {
  it("shows what the ID is, a shortened value and a copy button named for it", () => {
    const html = render(<Identifier kind="task" value="3f9a2c1d-0000-1111-2222-333344445555" />);
    expect(html).toContain("Task ID");
    expect(html).toContain("3f9a2c1d…5555");
    expect(html).not.toContain("3f9a2c1d-0000-1111");
    expect(html).toContain('aria-label="Copy Task ID"');
    expect(html).toContain('aria-label="Task ID: what is this?"');
  });

  it("keeps a very long ID to one short line on screen", () => {
    const html = render(<Identifier kind="context" value={LONG} />);
    expect(html).not.toContain(LONG);
    expect(html).toContain("truncate");
    expect(html).toContain("min-w-0");
  });

  it("can show the whole value, wrapping, and takes a more specific label", () => {
    const html = render(<Identifier kind="reference" label="Builds on" value={LONG} full />);
    expect(html).toContain(LONG);
    expect(html).toContain("break-all");
    expect(html).toContain("Builds on");
  });

  it("gives the copy icon a larger target on touch screens", () => {
    expect(render(<Identifier kind="task" value="abc" />)).toContain("pointer-coarse:size-8");
  });
});

describe("IdentifierList", () => {
  it("lists each ID with its name, protocol field, origin and explanation, wrapping long values and folding very long ones", () => {
    const html = render(<IdentifierList items={[{ kind: "context", value: LONG }, { kind: "record", value: "11111111-2222-3333-4444-555555555555" }]} />);
    expect(html).toContain(LONG); // folded by CSS, still all in the page for copy and screen readers
    expect(html).toContain("break-all");
    expect(html).toContain("line-clamp-3");
    expect(html).toContain(`Show all ${LONG.length} characters`);
    // An ordinary ID is shown whole with no toggle.
    expect(html.match(/Show all/g)).toHaveLength(1);
    expect(html).toContain("Context ID");
    expect(html).toContain("contextId");
    expect(html).toContain("Taskbay only");
    expect(html).toContain("A2A");
    expect(html).toContain("Groups related tasks and messages");
    expect(html).toContain('aria-label="Copy Taskbay ID"');
  });

  it("skips an ID that has no value and links one that has a target", () => {
    const html = render(<IdentifierList items={[{ kind: "context", value: undefined }, { kind: "tenant", value: "" }, { kind: "reference", value: "t-1", href: "/tasks/abc" }]} />);
    expect(html).not.toContain("Context ID");
    expect(html).not.toContain("Tenant");
    expect(html).toContain('href="/tasks/abc"');
    expect(html).toContain("Referenced task");
  });
});
