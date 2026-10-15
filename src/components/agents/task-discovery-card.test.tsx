import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaskDiscoveryView } from "./task-discovery-card";
import { TaskDiscoveryNotice } from "./task-discovery-notice";
import { modeAllowedByCap, type DiscoveryStatusView } from "@/lib/browse-tasks";

const now = Date.parse("2026-10-10T12:00:00Z");
const status = (extra: Partial<DiscoveryStatusView> = {}): DiscoveryStatusView => ({ mode: "browse", effectiveMode: "browse", cap: "browse", historyDays: 7, pausedReason: null,
  listing: "unknown", auto: null, canBrowse: true, ...extra });
const render = (props: Partial<Parameters<typeof TaskDiscoveryView>[0]> = {}) =>
  renderToStaticMarkup(<TaskDiscoveryView status={status()} admin now={now} onChange={() => undefined} onBrowse={() => undefined} {...props} />);

// The repository has no browser test environment, so these check what the card shows in each state.
describe("TaskDiscoveryView", () => {
  it("offers Browse only and Off, with what each does, and leaves Automatic out until it exists", () => {
    const html = render();
    expect(html).toContain("Browse only");
    expect(html).toContain("Nothing is stored until a task is tracked.");
    expect(html).toContain("Taskbay never lists this agent&#x27;s tasks.");
    expect(html).not.toContain("Automatic");
  });

  it("shows Automatic when the agent is already set to it", () => {
    expect(render({ status: status({ mode: "auto", effectiveMode: "auto" }) })).toContain("Automatic");
  });

  it("offers Browse tasks only to people who may browse", () => {
    expect(render()).toContain("Browse tasks");
    expect(render({ status: status({ canBrowse: false }) })).not.toContain("Browse tasks");
    expect(render({ onBrowse: undefined })).not.toContain("Browse tasks");
  });

  it("is read-only for people who are not administrators", () => {
    const html = render({ admin: false });
    expect(html).toContain("Only administrators can change this.");
    expect(html).toMatch(/aria-disabled="true"/);
    expect(render()).not.toContain("Only administrators can change this.");
  });

  it("explains a mode the deployment limits", () => {
    const html = render({ status: status({ mode: "browse", effectiveMode: "off", cap: "off" }) });
    expect(html).toContain("This deployment allows up to off.");
    expect(html).toContain("This deployment limits discovery to “off”, so “off” applies.");
  });

  it("says when the agent cannot list tasks", () => {
    expect(render({ status: status({ listing: "unsupported" }) })).toContain("This agent does not support listing tasks");
  });

  it("shows automatic discovery's progress and a pause", () => {
    const html = render({ status: status({ mode: "auto", effectiveMode: "auto", pausedReason: "Reached the limit of 5,000 discovered tasks.",
      auto: { lastCheckedAt: "2026-10-10T11:58:00Z", lastFullSweepAt: null, foundTotal: 14 } }) });
    expect(html).toContain("Checked 2m ago · 14 found");
    expect(html).toContain("Reached the limit of 5,000 discovered tasks.");
    expect(render({ status: status({ mode: "auto", effectiveMode: "auto", auto: { lastCheckedAt: null, lastFullSweepAt: null, foundTotal: 0 } }) })).toContain("Not checked yet");
  });

  it("shows a failure to save", () => {
    expect(render({ error: "This action is not permitted." })).toContain("This action is not permitted.");
  });
});

describe("modeAllowedByCap", () => {
  it("never allows more than the cap", () => {
    expect(modeAllowedByCap("browse", "browse")).toBe(true);
    expect(modeAllowedByCap("off", "off")).toBe(true);
    expect(modeAllowedByCap("browse", "off")).toBe(false);
    expect(modeAllowedByCap("auto", "browse")).toBe(false);
    expect(modeAllowedByCap("auto", "auto")).toBe(true);
  });
});

describe("TaskDiscoveryNotice", () => {
  it("says what connecting allows, and that nothing is stored until a task is tracked", () => {
    const html = renderToStaticMarkup(<TaskDiscoveryNotice />);
    expect(html).toContain("list the tasks on this agent");
    expect(html).toContain("Nothing is stored until a task is tracked.");
  });
  it("says task discovery is off when the deployment forbids it", () => {
    const html = renderToStaticMarkup(<TaskDiscoveryNotice cap="off" />);
    expect(html).toContain("Task discovery is turned off for this deployment.");
    expect(html).not.toContain("list the tasks");
  });
});
