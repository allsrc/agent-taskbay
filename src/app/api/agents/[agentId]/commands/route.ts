import { agentRegistry } from "@/lib/agent-registry";
import { apiError } from "@/lib/api-response";
import { readJsonRequest } from "@/lib/request-guard";
import { acceptCommand, commandView } from "@/server/runtime/commands";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  try {
    const agent = await agentRegistry().get((await context.params).agentId);
    if (!agent) return Response.json({ error: { message: "Unknown agent." } }, { status: 404 });
    const command = await acceptCommand(agent.id, await readJsonRequest(request), request.headers.get("Idempotency-Key") ?? "");
    return Response.json({ command: commandView(command) }, { status: 202,
      headers: { "Cache-Control": "no-store", Location: `/api/commands/${command.id}` } });
  } catch (error) { return apiError(error, 400); }
}
