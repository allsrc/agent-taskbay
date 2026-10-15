import { authenticatedRoute } from "@/server/runtime/identity";
import { agentRegistry } from "@/lib/agent-registry";
import { apiError } from "@/lib/api-response";
import { refreshExtendedCard } from "@/server/runtime/extended-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(_request: Request, context: { params: Promise<{ agentId: string }> }) {
  try {
    const agent = await agentRegistry().get((await context.params).agentId);
    if (!agent) return Response.json({ error: { message: "Unknown agent." } }, { status: 404, headers: { "Cache-Control": "no-store" } });
    const result = await refreshExtendedCard(agent.id);
    return Response.json(result ?? { available: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export const POST = authenticatedRoute("administer", handlePOST);
