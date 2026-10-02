import { apiError } from "@/lib/api-response";
import { withTaskQueries } from "@/server/runtime/task-persistence";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filter = url.searchParams.get("filter") ?? "all";
    if (!["all", "active", "needs-input", "done"].includes(filter)) return Response.json({ error: { message: "Invalid task filter." } }, { status: 400 });
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
      return Response.json({ error: { message: "limit must be 1–100 and offset must be non-negative." } }, { status: 400 });
    }
    const tasks = await withTaskQueries((queries, organizationId) => queries.list(organizationId, limit, offset, filter));
    return Response.json({ tasks }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 500); }
}
