import { z } from "zod";
import { authenticatedRoute } from "@/server/runtime/identity";
import { agentRegistry } from "@/lib/agent-registry";
import { apiError } from "@/lib/api-response";
import { readJsonRequest } from "@/lib/request-guard";
import { trackRemoteTask } from "@/server/runtime/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Only an ID goes in: Taskbay reads the task from the agent itself and ignores anything else the browser could send.
const body = z.object({ taskId: z.string().min(1).max(255), tenant: z.string().max(255).optional() }).strict();

async function handlePOST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  try {
    const agent = await agentRegistry().get((await context.params).agentId);
    if (!agent) return Response.json({ error: { message: "Unknown agent.", kind: "unknown_agent" } }, { status: 404 });
    const parsed = body.safeParse(await readJsonRequest(request));
    if (!parsed.success) return Response.json({ error: { message: parsed.error.issues.map((issue) => issue.message).join("; "), kind: "invalid_request" } }, { status: 400 });
    const result = await trackRemoteTask(agent.id, parsed.data);
    return Response.json(result, { status: result.created ? 201 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error, 502); }
}

export const POST = authenticatedRoute("operate", handlePOST);
