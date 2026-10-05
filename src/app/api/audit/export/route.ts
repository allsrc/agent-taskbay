import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { requirePrincipal } from "@/server/runtime/decisions";
import { auditCsv, createAuditService, parseAuditQuery } from "@/server/runtime/audit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Administrator export of one bounded page (up to 200 rows) of the filtered trail; follow `X-Next-Cursor` for more. */
async function handleGET(request: Request) {
  try {
    const principal = requirePrincipal();
    const params = new URL(request.url).searchParams;
    if (!params.get("limit")) params.set("limit", "200");
    const page = await createAuditService().page(principal, parseAuditQuery(params));
    return new Response(auditCsv(page), { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store",
      "Content-Disposition": 'attachment; filename="audit-trail.csv"', "X-Content-Type-Options": "nosniff", ...(page.next ? { "X-Next-Cursor": page.next } : {}) } });
  } catch (error) { return apiError(error, 400); }
}

export const GET = authenticatedRoute("administer", handleGET);
