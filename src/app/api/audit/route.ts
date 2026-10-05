import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { requirePrincipal } from "@/server/runtime/decisions";
import { auditView, createAuditService, parseAuditQuery } from "@/server/runtime/audit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(request: Request) {
  try {
    const principal = requirePrincipal();
    const page = await createAuditService().page(principal, parseAuditQuery(new URL(request.url).searchParams));
    return Response.json(auditView(page, principal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 400); }
}

export const GET = authenticatedRoute("read", handleGET);
