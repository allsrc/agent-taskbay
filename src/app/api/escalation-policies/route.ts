import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { readJsonRequest } from "@/lib/request-guard";
import { requirePrincipal } from "@/server/runtime/decisions";
import { createWorkflowService, listPolicies, parseWorkflowBody, policySchema, policyView } from "@/server/runtime/workflow";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET() {
  try { return Response.json(await listPolicies(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return apiError(error, 400); }
}
async function handlePUT(request: Request) {
  try {
    const policy = await createWorkflowService().setPolicy(requirePrincipal(), parseWorkflowBody(policySchema, await readJsonRequest(request)));
    return Response.json({ policy: policyView(policy) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 400); }
}

export const GET = authenticatedRoute("administer", handleGET);
export const PUT = authenticatedRoute("administer", handlePUT);
