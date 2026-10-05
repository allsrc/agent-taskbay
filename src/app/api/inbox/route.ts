import { authenticatedRoute } from "@/server/runtime/identity";
import { apiError } from "@/lib/api-response";
import { InboxError } from "@/server/application/services/inbox-query";
import { readInbox } from "@/server/runtime/inbox";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The caller's authorized work across agents: tasks and approval requests, newest first, with keyset paging. */
async function handleGET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const limit = params.get("limit");
    const page = await readInbox({
      view: params.get("view") ?? undefined, kind: params.get("kind") ?? undefined, agentId: params.get("agentId") ?? undefined,
      skillId: params.get("skillId") ?? undefined, risk: params.get("risk") ?? undefined, status: params.get("status") ?? undefined,
      updatedAfter: params.get("updatedAfter") ?? undefined, cursor: params.get("cursor") ?? undefined, limit: limit === null ? undefined : Number(limit),
    });
    return Response.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return error instanceof InboxError ? Response.json({ error: { message: error.message } }, { status: error.status }) : apiError(error, 500); }
}

export const GET = authenticatedRoute("read", handleGET);
