import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExtendedCardStatus } from "./extended-card-row";

const render = (extra: Partial<Parameters<typeof ExtendedCardStatus>[0]> = {}) => renderToStaticMarkup(
  <ExtendedCardStatus advertised admin busy={false} unavailable={false} failed={false} onFetch={() => undefined} {...extra} />);

describe("extended card controls", () => {
  it("offers Fetch only to an admin when advertised", () => {
    expect(render()).toContain(">Fetch<");
    expect(render({ admin: false })).not.toContain("<button");
    expect(render({ advertised: false })).toContain("Not advertised");
    expect(render({ advertised: false })).not.toContain("<button");
  });
  it("shows the stored fetch time and Refresh", () => {
    const html = render({ card: { fetchedAt: "2026-10-16T00:00:00Z", skills: [], capabilities: { streaming: true, pushNotifications: false } } });
    expect(html).toContain('dateTime="2026-10-16T00:00:00Z"');
    expect(html).toContain("Fetched"); expect(html).toContain(">Refresh<");
  });
  it("shows neutral unavailability, failure with retry, and disabled progress", () => {
    expect(render({ unavailable: true })).toContain("Not configured on this agent");
    expect(render({ failed: true })).toContain("Fetch failed"); expect(render({ failed: true })).toContain(">Retry<");
    expect(render({ busy: true })).toContain("Fetching…"); expect(render({ busy: true })).toContain('disabled=""');
  });
});
