import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextFilterChip } from "./context-filter-chip";

describe("ContextFilterChip", () => {
  it("shows the first 8 characters of the context as text and says it removes the filter", () => {
    const html = renderToStaticMarkup(<ContextFilterChip contextId="77ab12cd-aaaa-bbbb" onClear={() => {}} />);
    expect(html).toContain("Context: 77ab12cd");
    expect(html).not.toContain("aaaa-bbbb");
    expect(html).toContain('aria-label="Remove context filter 77ab12cd"');
  });
  it("never renders agent-supplied markup", () => {
    const html = renderToStaticMarkup(<ContextFilterChip contextId="<img src=x>" onClear={() => {}} />);
    expect(html).not.toContain("<img");
  });
});
