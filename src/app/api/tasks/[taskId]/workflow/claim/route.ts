import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { requirePrincipal } from "@/server/runtime/decisions";
import { assignmentView, createWorkflowService } from "@/server/runtime/workflow";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const assignment = await createWorkflowService().claim(requirePrincipal(), (await context.params).taskId);
    return Response.json({ assignment: assignmentView(assignment) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 400); }
}

export const POST = authenticatedRoute("operate", handlePOST);
