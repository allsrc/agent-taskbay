import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { withTaskQueries } from "@/server/runtime/task-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Durable content for Chat, flows and derived alerts, including direct Messages. */
async function handleGET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 100);
    const after = url.searchParams.get("after") ?? undefined;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
      (after !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(after))) {
      return Response.json({ error: { message: "limit must be 1–100 and after must be a local UUID." } }, { status: 400 });
    }
    const page = await withTaskQueries((queries, organizationId) => queries.contentPage(organizationId, limit, after));
    return Response.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 500); }
}

export const GET = authenticatedRoute("read", handleGET);
