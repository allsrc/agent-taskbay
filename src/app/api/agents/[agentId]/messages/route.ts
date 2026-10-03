import { authenticatedRoute } from "@/server/runtime/identity";
import { agentRegistry } from "@/lib/agent-registry";
import { apiError } from "@/lib/api-response";
import { readJsonRequest } from "@/lib/request-guard";
import { acceptCommand, waitForCommand, legacyCommandResponse, compatibilityCommandKey } from "@/server/runtime/commands";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** Compatibility blocking response over durable command dispatch. */
async function handlePOST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  try {
    const agent = await agentRegistry().get((await context.params).agentId);
    if (!agent) return Response.json({ error: { message: "Unknown agent." } }, { status: 404 });
    const body = await readJsonRequest<{ messageId?: string; tenant?: string }>(request);
    const command = await acceptCommand(agent.id, body, request.headers.get("Idempotency-Key") ?? compatibilityCommandKey(agent.id, body?.tenant, body?.messageId));
    return Response.json(legacyCommandResponse(await waitForCommand(command.id, request.signal)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export const POST = authenticatedRoute("operate", handlePOST);
