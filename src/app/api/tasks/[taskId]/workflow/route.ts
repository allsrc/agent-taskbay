import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { readWorkflow } from "@/server/runtime/workflow";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const workflow = await readWorkflow((await context.params).taskId);
    return workflow ? Response.json(workflow, { headers: { "Cache-Control": "no-store" } }) :
      Response.json({ error: { message: "Task not found." } }, { status: 404, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 400); }
}

export const GET = authenticatedRoute("read", handleGET);
