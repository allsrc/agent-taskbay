import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { withTaskQueries } from "@/server/runtime/task-persistence";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const task = await withTaskQueries((queries, organizationId) => queries.detail(organizationId, taskId));
    return task ? Response.json({ task }, { headers: { "Cache-Control": "no-store" } }) :
      Response.json({ error: { message: "Task not found." } }, { status: 404 });
  } catch (error) { return apiError(error, 500); }
}

export const GET = authenticatedRoute("read", handleGET);
