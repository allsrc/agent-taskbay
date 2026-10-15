import { authenticatedRoute } from "@/server/runtime/identity";
import { agentRegistry } from "@/lib/agent-registry";
import { apiError } from "@/lib/api-response";
import { browseRemoteTasks } from "@/server/runtime/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lists the agent's tasks now, using the agent's own credential. Nothing is stored. */
async function handleGET(request: Request, context: { params: Promise<{ agentId: string }> }) {
  try {
    const agent = await agentRegistry().get((await context.params).agentId);
    if (!agent) return Response.json({ error: { message: "Unknown agent.", kind: "unknown_agent" } }, { status: 404 });
    const params = new URL(request.url).searchParams;
    const size = params.get("pageSize");
    const result = await browseRemoteTasks(agent.id, {
      tenant: params.get("tenant") ?? "", contextId: params.get("contextId") ?? undefined, status: params.get("status") ?? undefined,
      pageToken: params.get("pageToken") ?? undefined, pageSize: size === null ? undefined : Number(size),
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 502); }
}

export const GET = authenticatedRoute("operate", handleGET);
