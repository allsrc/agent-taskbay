import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { readJsonRequest } from "@/lib/request-guard";
import { decideSchema, decisionView, executionView, createDecisionService, parseBody, toAction, requestView, requirePrincipal } from "@/server/runtime/decisions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(request: Request, context: { params: Promise<{ decisionId: string }> }) {
  try {
    const body = parseBody(decideSchema, await readJsonRequest(request));
    const result = await createDecisionService().decide({ principal: requirePrincipal(), requestId: (await context.params).decisionId,
      idempotencyKey: request.headers.get("Idempotency-Key") ?? "", outcome: body.outcome, rationale: body.rationale,
      expectedRevision: body.expectedRevision, delegateMembershipId: body.delegateMembershipId,
      edit: body.edit ? toAction(body.edit) : undefined });
    // A refusal such as expiry is durable (the request is now closed), but it authorizes nothing.
    if (result.kind === "refused") return Response.json({ error: { message: `This request is ${result.reason} and can no longer authorize an action.` },
      decision: requestView(result.request) }, { status: 409, headers: { "Cache-Control": "no-store" } });
    return Response.json({ decision: decisionView(result.decision), request: requestView(result.request),
      execution: result.execution ? executionView(result.execution) : null, replay: result.replay },
    { status: result.replay ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 400); }
}

export const POST = authenticatedRoute("operate", handlePOST);
