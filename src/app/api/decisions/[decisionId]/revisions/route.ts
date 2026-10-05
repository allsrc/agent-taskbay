import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { readJsonRequest } from "@/lib/request-guard";
import { createDecisionService, parseBody, toAction, requestView, requirePrincipal, reviseDecisionSchema, revisionView } from "@/server/runtime/decisions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(request: Request, context: { params: Promise<{ decisionId: string }> }) {
  try {
    const body = parseBody(reviseDecisionSchema, await readJsonRequest(request));
    const result = await createDecisionService().revise({ principal: requirePrincipal(), requestId: (await context.params).decisionId,
      expectedRevision: body.expectedRevision, action: toAction(body.action) });
    return Response.json({ decision: requestView(result.request), revision: revisionView(result.revision) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 400); }
}

export const POST = authenticatedRoute("operate", handlePOST);
