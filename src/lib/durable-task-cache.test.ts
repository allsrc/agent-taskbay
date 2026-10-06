import { afterEach, expect, it, vi } from "vitest";
import { readDurableTasks } from "./durable-task-cache";

afterEach(() => vi.unstubAllGlobals());

it("TSK-002 loads every content page without browser storage and keeps local scoped identities", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ tasks: [{ localId: "one", taskId: "same" }], next: "one" }))
    .mockResolvedValueOnce(Response.json({ tasks: [{ localId: "two", taskId: "same" }, { localId: "reply", kind: "message" }], next: null }));
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  expect((await readDurableTasks(signal)).map((task) => task.localId)).toEqual(["one", "two", "reply"]);
  expect(fetcher).toHaveBeenLastCalledWith("/api/task-views?limit=100&after=one", { cache: "no-store", signal });
});

it("REL-002 refuses partial refreshes and detects a cursor loop", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ tasks: [{ localId: "one" }], next: "one" }))
    .mockResolvedValueOnce(Response.json({ error: { message: "Unavailable" } }, { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(readDurableTasks(new AbortController().signal)).rejects.toThrow("Unavailable");
  fetcher.mockReset().mockImplementation(async () => Response.json({ tasks: [], next: "one" }));
  await expect(readDurableTasks(new AbortController().signal)).rejects.toThrow("did not advance");
});
