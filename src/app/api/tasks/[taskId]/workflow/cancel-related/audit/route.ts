import { authenticatedRoute } from "@/server/runtime/identity";
import { requirePrincipal } from "@/server/runtime/decisions";
import { recordCancelRelatedAudit } from "@/server/runtime/audit";
import { readJsonRequest } from "@/lib/request-guard";
import { apiError } from "@/lib/api-response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    await recordCancelRelatedAudit(requirePrincipal(), (await context.params).taskId, await readJsonRequest(request));
    return Response.json({ recorded: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 400); }
}
export const POST = authenticatedRoute("operate", handlePOST);
