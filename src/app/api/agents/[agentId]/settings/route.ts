import { authenticatedRoute } from "@/server/runtime/identity";
import { agentRegistry } from "@/lib/agent-registry";
import { apiError } from "@/lib/api-response";
import { readJsonRequest } from "@/lib/request-guard";
import { currentPrincipal } from "@/server/adapters/auth/principal-context";
import { agentSettingsSchema, changeAgentSettings } from "@/server/runtime/agent-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePATCH(request: Request, context: { params: Promise<{ agentId: string }> }) {
  try {
    const principal = currentPrincipal();
    if (!principal) return Response.json({ error: { message: "Sign in to continue." } }, { status: 401 });
    const agent = await agentRegistry().get((await context.params).agentId);
    if (!agent) return Response.json({ error: { message: "Unknown agent." } }, { status: 404 });
    const parsed = agentSettingsSchema.safeParse(await readJsonRequest(request));
    if (!parsed.success) return Response.json({ error: { message: parsed.error.issues.map((issue) => issue.message).join("; ") } }, { status: 400 });
    await changeAgentSettings(principal, agent.id, parsed.data);
    return Response.json({ agentId: agent.id, ...parsed.data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 500); }
}

export const PATCH = authenticatedRoute("administer", handlePATCH);
