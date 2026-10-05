import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { withTaskQueries } from "@/server/runtime/task-persistence";
import { requirePrincipal } from "@/server/runtime/decisions";
import { workflowSummaries, workflowTaskIds } from "@/server/runtime/workflow";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(request: Request) {
  try {
    const url = new URL(request.url);
    const filter = url.searchParams.get("filter") ?? "all";
    if (!["all", "active", "needs-input", "done", "mine", "overdue", "unassigned"].includes(filter)) return Response.json({ error: { message: "Invalid task filter." } }, { status: 400 });
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
      return Response.json({ error: { message: "limit must be 1–100 and offset must be non-negative." } }, { status: 400 });
    }
    requirePrincipal();
    const workflowFilter = ["mine", "overdue", "unassigned"].includes(filter) ? filter as "mine" | "overdue" | "unassigned" : undefined;
    const ids = workflowFilter ? await workflowTaskIds(workflowFilter) : undefined;
    const restriction = !workflowFilter ? undefined : workflowFilter === "unassigned" ? { exclude: ids } : { include: ids };
    const rows = await withTaskQueries((queries, organizationId) => queries.list(organizationId, limit, offset, filter, restriction));
    // Ownership and due time ride along so the list can show who has each task without a request per row.
    const summaries = await workflowSummaries(rows.map((task) => task.localId));
    const tasks = rows.map((task) => ({ ...task, workflow: summaries.get(task.localId) ?? null }));
    return Response.json({ tasks }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 500); }
}

export const GET = authenticatedRoute("read", handleGET);
