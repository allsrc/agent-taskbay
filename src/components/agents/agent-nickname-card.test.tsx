import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentNicknameCard } from "./agent-nickname-card";

const render = (props: Partial<Parameters<typeof AgentNicknameCard>[0]> = {}) =>
  renderToStaticMarkup(<AgentNicknameCard agentId="a" admin={false} onChanged={() => undefined} {...props} />);

// No browser test environment exists, so these check the rendered states; the settings route is covered by the database and HTTP suites.
describe("AgentNicknameCard", () => {
  it("gives an administrator a named field, prefilled, and a way to clear it", () => {
    const html = render({ admin: true, nickname: "Support (ADK)", cardName: "Support" });
    expect(html).toContain('aria-label="Nickname"');
    expect(html).toContain('value="Support (ADK)"');
    expect(html).toContain("Clear");
    expect(html).toContain("The agent calls itself");
  });

  it("offers no field to a non-administrator and shows the nickname as text", () => {
    const html = render({ nickname: "<b>x</b>" });
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<b>x</b>");
  });

  it("says when none is set", () => {
    expect(render()).toContain("None set.");
  });
});
