import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RequiredExtensionsNotice } from "./required-extensions-notice";

const uri = "https://example.test/extensions/needed/v1";
const render = (props: Partial<Parameters<typeof RequiredExtensionsNotice>[0]> = {}) =>
  renderToStaticMarkup(<RequiredExtensionsNotice agentId="a" unsupported={[uri]} override={false} admin={false} onChanged={() => undefined} {...props} />);

// The repository has no browser test environment (see the limitation on structured forms), so these check the rendered states;
// the settings route behind the switch is covered by the HTTP suite.
describe("RequiredExtensionsNotice", () => {
  it("renders nothing when every required extension is supported", () => {
    expect(render({ unsupported: [], admin: true })).toBe("");
  });

  it("tells a non-administrator that sending is blocked and offers no switch", () => {
    const html = render();
    expect(html).toContain("This agent requires an extension Taskbay does not support");
    expect(html).toContain("Sending is blocked while this is the case.");
    expect(html).toContain("Ask an administrator if you need to send anyway.");
    expect(html).not.toContain('role="switch"');
  });

  it("gives an administrator a named switch", () => {
    const html = render({ admin: true });
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-label="Allow sending without the required extension"');
    expect(html).toContain("Allow sending without it (audited)");
    expect(html).not.toContain("Ask an administrator");
  });

  it("says when the override is on, and warns instead of blocking", () => {
    const html = render({ override: true, admin: true });
    expect(html).toContain("Sending is allowed because an administrator overrode this.");
    expect(html).not.toContain("Sending is blocked");
  });

  it("shows the agent's extension address as text, never as a link or markup", () => {
    const hostile = "https://example.test/<img src=x onerror=alert(1)>";
    const html = render({ unsupported: [uri, hostile] });
    expect(html).toContain(uri);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a ");
  });
});
