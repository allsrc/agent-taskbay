import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { readJsonRequest } from "@/lib/request-guard";
import { requirePrincipal } from "@/server/runtime/decisions";
import { createWorkflowService, noteSchema, noteView, parseWorkflowBody } from "@/server/runtime/workflow";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const body = parseWorkflowBody(noteSchema, await readJsonRequest(request));
    const note = await createWorkflowService().addNote(requirePrincipal(), (await context.params).taskId, body);
    return Response.json({ note: noteView(note) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 400); }
}

export const POST = authenticatedRoute("operate", handlePOST);
