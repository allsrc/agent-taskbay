import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { withTaskQueries } from "@/server/runtime/task-persistence";
import { requirePrincipal } from "@/server/runtime/decisions";
import { decodeTaskCursor } from "@/server/domain/task-cursor";
import { workflowSummaries, workflowTaskIds } from "@/server/runtime/workflow";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(request: Request) {
  try {
    const url = new URL(request.url);
    const filter = url.searchParams.get("filter") ?? "all";
    if (!["all", "active", "needs-input", "done", "mine", "overdue", "unassigned"].includes(filter)) return Response.json({ error: { message: "Invalid task filter." } }, { status: 400 });
    const origin = url.searchParams.get("origin");
    if (origin !== null && origin !== "created" && origin !== "discovered") return Response.json({ error: { message: "origin must be created or discovered." } }, { status: 400 });
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
      return Response.json({ error: { message: "limit must be 1–100 and offset must be non-negative." } }, { status: 400 });
    }
    const bad = (message: string) => Response.json({ error: { message } }, { status: 400 });
    const contextId = url.searchParams.get("contextId");
    if (contextId !== null && (contextId.length < 1 || contextId.length > 255)) return bad("contextId must be 1–255 characters.");
    const agentId = url.searchParams.get("agentId");
    if (agentId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentId)) return bad("agentId must be a UUID.");
    const updatedAfterText = url.searchParams.get("updatedAfter");
    const updatedAfter = updatedAfterText === null ? undefined : new Date(updatedAfterText);
    if (updatedAfterText !== null && (!/^\d{4}-\d{2}-\d{2}(T|$)/.test(updatedAfterText) || Number.isNaN(updatedAfter?.getTime()))) return bad("updatedAfter must be an ISO 8601 date or time.");
    const afterText = url.searchParams.get("after");
    const after = afterText === null ? undefined : decodeTaskCursor(afterText);
    if (afterText !== null && !after) return bad("after is not a valid cursor.");
    if (after && offset !== 0) return bad("after cannot be combined with a non-zero offset.");
    requirePrincipal();
    const workflowFilter = ["mine", "overdue", "unassigned"].includes(filter) ? filter as "mine" | "overdue" | "unassigned" : undefined;
    const ids = workflowFilter ? await workflowTaskIds(workflowFilter) : undefined;
    const restriction = !workflowFilter ? undefined : workflowFilter === "unassigned" ? { exclude: ids } : { include: ids };
    const page = await withTaskQueries((queries, organizationId) => queries.listPage(organizationId, {
      limit, offset, filter, restriction, origin: origin ?? undefined, contextId: contextId ?? undefined, agentId: agentId ?? undefined, updatedAfter, after,
    }));
    // Ownership and due time ride along so the list can show who has each task without a request per row.
    const summaries = await workflowSummaries(page.tasks.map((task) => task.localId));
    const tasks = page.tasks.map((task) => ({ ...task, workflow: summaries.get(task.localId) ?? null }));
    return Response.json({ tasks, next: page.next },{ headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 500); }
}

export const GET = authenticatedRoute("read", handleGET);
