import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { withTaskQueries } from "@/server/runtime/task-persistence";
import { runtimeFreshness } from "@/server/runtime/freshness";
import { freshnessStream } from "@/server/adapters/live/freshness-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(request: Request) {
  try {
    // Like task reads, scope comes from the server, never a query/header selector.
    const organizationId = await withTaskQueries(async (_queries, organization) => organization);
    const reader = runtimeFreshness();
    await reader.readToken(organizationId); // Fail before returning streaming headers.
    return new Response(freshnessStream(reader, organizationId, request.signal), {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no" },
    });
  } catch (error) { return apiError(error, 500); }
}

export const GET = authenticatedRoute("read", handleGET);
