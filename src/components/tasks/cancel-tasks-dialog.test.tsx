// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CancelTasksDialog } from "./cancel-tasks-dialog";
import type { DurableTaskView, RelatedTask } from "@/shared/task-types";

vi.mock("@/components/patterns/responsive-dialog", () => ({ ResponsiveDialog: ({ title, description, children, footer }: { title: ReactNode; description: ReactNode; children: ReactNode; footer: ReactNode }) => <div role="dialog">{title}{description}{children}{footer}</div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const related = (localId: string, extra: Partial<RelatedTask> = {}): RelatedTask => ({ localId, taskId: `remote-${localId}`, agentId: "agent", tenant: "tenant", agentName: "Agent", state: "TASK_STATE_WORKING", title: localId, canOperate: true, cancelable: true, ...extra });
const detail = (): DurableTaskView => ({ ...related("current"), createdAt: "2026-10-16T00:00:00Z", updatedAt: "2026-10-16T00:00:00Z", referenceLinks: {}, messages: [], artifacts: [], kind: "task",
  related: { references: [related("first"), related("blocked", { canOperate: false }), related("done", { cancelable: false, state: "TASK_STATE_COMPLETED" })], referencedBy: [related("first"), related("last")] } });
let container: HTMLDivElement, root: Root;
const buttons = () => [...container.querySelectorAll("button")];
const click = async (text: string) => act(async () => { buttons().find((button) => button.textContent?.includes(text))!.click(); });
const checks = () => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let calls: string[], auditFail: boolean;
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); calls = []; auditFail = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/audit")) return response({}, auditFail ? 500 : 200);
    if (init?.method === "POST") return response({ result: { status: { state: "TASK_STATE_CANCELED" } } });
    return response({ task: detail() });
  }));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const mount = async (selectRelated = false) => act(async () => root.render(<CancelTasksDialog taskId="current" selectRelated={selectRelated} onClose={vi.fn()} onUpdated={vi.fn()} />));

describe("cancel tasks dialog", () => {
  it("defaults to this task; deduplicates cycles and shows disabled reasons", async () => {
    await mount();
    expect(checks().map((input) => input.checked)).toEqual([true, false, false, false, false]);
    expect(checks().map((input) => input.disabled)).toEqual([false, false, true, true, false]);
    expect(container.textContent).toContain("needs someone with access");
    expect(container.textContent).toContain("This task is finished.");
    await click("Cancel 1 task");
    expect(calls.filter((call) => call.startsWith("POST") && call.includes("/cancel?"))).toEqual(["POST /api/agents/agent/tasks/remote-current/cancel?tenant=tenant"]);
    expect(container.textContent).toContain("1 requested · 1 canceled");
  });

  it("preselects operable tasks, sends sequentially, continues after refusal, and never sends disabled tasks", async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.mocked(fetch);
    const fallback = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).includes("remote-current/cancel")) { calls.push(`POST ${url}`); return new Promise<Response>((resolve) => { finish = resolve; }); }
      if (String(url).includes("remote-first/cancel")) { calls.push(`POST ${url}`); return response({ error: { kind: "task_not_cancelable", message: "<script>unsafe</script>" } }, 409); }
      return fallback(url, init);
    });
    await mount(true);
    expect(checks().map((input) => input.checked)).toEqual([true, true, false, false, true]);
    await click("Cancel 3 tasks");
    expect(calls.filter((call) => call.includes("/cancel?"))).toHaveLength(1);
    expect(checks().every((input) => input.disabled)).toBe(true);
    await act(async () => { finish(response({ result: { status: { state: "TASK_STATE_CANCELED" } } })); });
    expect(calls.filter((call) => call.includes("/cancel?"))).toHaveLength(3);
    expect(container.textContent).toContain("Agent refused: not cancelable");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("3 requested · 2 canceled · 1 refused · 0 failed");
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    const keys = posts.map(([, init]) => (init?.headers as Record<string, string>)["Idempotency-Key"]).filter(Boolean);
    expect(new Set(keys).size).toBe(3);
  });

  it("respects checkbox selection and saves a failed summary again without repeating cancels", async () => {
    auditFail = true; await mount(true);
    await act(async () => checks()[4].click());
    await click("Cancel 2 tasks");
    expect(container.textContent).toContain("Could not record the cancel summary");
    auditFail = false; await click("Save summary again");
    expect(calls.filter((call) => call.includes("/cancel?"))).toHaveLength(2);
    expect(calls.filter((call) => call.endsWith("/audit"))).toHaveLength(2);
    const audits = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/audit"));
    expect(audits[0][1]?.body).toBe(audits[1][1]?.body);
    expect(container.textContent).not.toContain("Could not record the cancel summary");
  });

  it("does not report a successful HTTP reply as canceled when the agent returns working", async () => {
    const fetchMock = vi.mocked(fetch), fallback = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => init?.method === "POST" && String(url).includes("/cancel?") ? response({ result: { status: { state: "TASK_STATE_WORKING" } } }) : fallback(url, init));
    await mount(); await click("Cancel 1 task");
    expect(container.textContent).toContain("1 requested · 0 canceled · 0 refused · 1 failed");
    expect(container.textContent).toContain("Taskbay can't tell whether the agent received this");
  });

  it("shows loading failure and lets the person load current states again", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({}, 404));
    await mount(); expect(container.textContent).toContain("Could not load tasks");
    await click("Load tasks again"); expect(checks()).toHaveLength(5);
  });
});
