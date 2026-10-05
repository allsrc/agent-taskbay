import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { readJsonRequest } from "@/lib/request-guard";
import { requirePrincipal } from "@/server/runtime/decisions";
import { assignmentView, assignSchema, createWorkflowService, parseWorkflowBody } from "@/server/runtime/workflow";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const body = parseWorkflowBody(assignSchema, await readJsonRequest(request));
    const assignment = await createWorkflowService().assign(requirePrincipal(), (await context.params).taskId, body.assigneeMembershipId);
    return Response.json({ assignment: assignmentView(assignment) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 400); }
}

export const POST = authenticatedRoute("operate", handlePOST);
