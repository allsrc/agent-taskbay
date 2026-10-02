import { agentRegistry } from "@/lib/agent-registry";
import { apiError } from "@/lib/api-response";
import { acceptCommand, waitForCommand, legacyCommandResponse } from "@/server/runtime/commands";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ agentId: string; taskId: string }> }) {
  try {
    const { agentId, taskId } = await context.params;
    const agent = await agentRegistry().get(agentId);
    if (!agent) return Response.json({ error: { message: "Unknown agent." } }, { status: 404 });
    const command = await acceptCommand(agent.id, { action: "cancelTask", taskId, tenant: new URL(request.url).searchParams.get("tenant") ?? "" },
      request.headers.get("Idempotency-Key") ?? crypto.randomUUID());
    return Response.json(legacyCommandResponse(await waitForCommand(command.id, request.signal)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
