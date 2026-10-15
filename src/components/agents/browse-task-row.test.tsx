import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrowseTaskRow } from "./browse-task-row";
import type { BrowseRowView } from "@/lib/browse-tasks";

const now = Date.parse("2026-10-10T12:00:00Z");
const row = (extra: Partial<BrowseRowView> = {}): BrowseRowView => ({ taskId: "3f9a2c1d-aaaa", contextId: "77ab12cd-bbbb", state: "TASK_STATE_INPUT_REQUIRED",
  updatedAt: "2026-10-10T11:56:00Z", title: "Reconcile invoices", snippet: "Which ledger should I use?", tracked: false, localId: null, ...extra });
const render = (props: Partial<Parameters<typeof BrowseTaskRow>[0]> = {}) => renderToStaticMarkup(<ul><BrowseTaskRow row={row()} now={now} onTrack={() => undefined} {...props} /></ul>);

// The repository has no browser test environment, so these check what a row renders; the dialog's behavior is covered by the browse routes' tests.
describe("BrowseTaskRow", () => {
  it("shows the title, ids, state, age and the agent's question in quotes", () => {
    const html = render();
    expect(html).toContain("Reconcile invoices");
    expect(html).toContain("3f9a2c1d · context 77ab12cd · updated 4m");
    expect(html).toContain("Input required");
    expect(html).toContain("“Which ledger should I use?”");
  });

  it("falls back to a short ID when the agent gave no title", () => {
    expect(render({ row: row({ title: null }) })).toContain("Task 3f9a2c1d");
  });

  it("offers Track with the task named, and nothing else, for a task that is not stored", () => {
    const html = render();
    expect(html).toContain('aria-label="Track Reconcile invoices"');
    expect(html).not.toContain("Open");
    expect(html).not.toContain("Tracked");
  });

  it("shows Tracked and a link to the stored task once it is stored", () => {
    const html = render({ row: row({ tracked: true, localId: "11111111-2222-3333-4444-555555555555" }) });
    expect(html).toContain("Tracked");
    expect(html).toContain('href="/tasks/11111111-2222-3333-4444-555555555555"');
    expect(html).toContain('aria-label="Open Reconcile invoices"');
    expect(html).not.toContain('aria-label="Track ');
  });

  it("disables Track while it runs", () => {
    expect(render({ busy: true })).toMatch(/<button[^>]*disabled/);
  });

  it("shows why a track failed, in the console's own words", () => {
    const html = render({ failure: { kind: "task_not_found_on_agent", message: "Remote said <b>no</b>" } });
    expect(html).toContain("The agent does not have a task with that ID.");
    expect(html).not.toContain("Remote said");
  });

  it("shows hostile text from the agent as inert text and never as a link or markup", () => {
    const hostile = '<img src=x onerror=alert(1)> [click](https://evil.example) **bold**';
    const html = render({ row: row({ title: hostile, snippet: hostile, contextId: hostile }) });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<strong>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("omits the age and context when the agent gave none", () => {
    const html = render({ row: row({ updatedAt: null, contextId: null }) });
    expect(html).toContain(">3f9a2c1d<");
    expect(html).not.toContain("updated");
    expect(html).not.toContain("context");
  });
});
