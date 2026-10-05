import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { readJsonRequest } from "@/lib/request-guard";
import { createDecisionService, listDecisions, openDecisionSchema, parseBody, toAction, requestView, requirePrincipal } from "@/server/runtime/decisions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["pending", "approved", "rejected", "changes_requested", "expired", "superseded"] as const;

async function handleGET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const status = params.get("status");
    if (status && !(STATUSES as readonly string[]).includes(status)) return Response.json({ error: { message: "Unknown status." } }, { status: 400 });
    const requests = await listDecisions({ status: (status ?? undefined) as (typeof STATUSES)[number] | undefined,
      taskId: params.get("taskId") ?? undefined, mine: params.get("assigned") === "me" });
    return Response.json({ decisions: requests }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 400); }
}

async function handlePOST(request: Request) {
  try {
    const principal = requirePrincipal();
    const body = parseBody(openDecisionSchema, await readJsonRequest(request));
    const key = body.requestKey ?? request.headers.get("Idempotency-Key") ?? "";
    const { requestKey: _ignored, expiresAt, action, ...rest } = body;
    void _ignored;
    const result = await createDecisionService().open({ ...rest, principal, requestKey: key, expiresAt: new Date(expiresAt),
      action: toAction(action) });
    return Response.json({ decision: requestView(result.request) }, { status: result.created ? 201 : 200,
      headers: { "Cache-Control": "no-store", Location: `/api/decisions/${result.request.id}` } });
  } catch (error) { return apiError(error, 400); }
}

export const GET = authenticatedRoute("read", handleGET);
export const POST = authenticatedRoute("operate", handlePOST);
