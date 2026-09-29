import { NextResponse } from "next/server";
import { agentRegistry } from "@/lib/agent-registry";
import { executeOperation } from "@/lib/gateway";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `tasks/cancel` (A2A spec §3.1.5). The agent may reject this with
 * TaskNotCancelableError if the task is already in a terminal state --
 * that comes back as a normal error response, not a special case here.
 */
export async function POST(_request: Request, context: { params: Promise<{ agentId: string; taskId: string }> }) {
  const { agentId, taskId } = await context.params;
  const agent = await agentRegistry().get(agentId);
  if (!agent) return NextResponse.json({ error: { message: "Unknown agent." } }, { status: 404 });
  try {
    const result = await executeOperation({
      connection: { cardUrl: agent.cardUrl, auth: { type: "none" }, headers: {} },
      action: "cancelTask",
      params: { taskId },
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
