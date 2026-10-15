import { authenticatedRoute } from "@/server/runtime/identity";
import { agentRegistry } from "@/lib/agent-registry";
import { apiError } from "@/lib/api-response";
import { currentPrincipal } from "@/server/adapters/auth/principal-context";
import { readDiscoveryStatus } from "@/server/runtime/agent-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How task discovery is set for this agent and what it has done. */
async function handleGET(_request: Request, context: { params: Promise<{ agentId: string }> }) {
  try {
    const principal = currentPrincipal();
    if (!principal) return Response.json({ error: { message: "Sign in to continue." } }, { status: 401 });
    const agent = await agentRegistry().get((await context.params).agentId);
    const status = agent && await readDiscoveryStatus(principal, agent.id);
    if (!status) return Response.json({ error: { message: "Unknown agent.", kind: "unknown_agent" } }, { status: 404 });
    return Response.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 500); }
}

export const GET = authenticatedRoute("read", handleGET);
