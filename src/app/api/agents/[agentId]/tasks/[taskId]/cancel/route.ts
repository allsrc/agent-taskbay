import { NextResponse } from "next/server";
import { agentRegistry } from "@/lib/agent-registry";
import { executeOperation } from "@/lib/gateway";
import { createTaskObserver } from "@/server/runtime/task-persistence";
import type { JsonValue } from "@/server/domain/persistence-model";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `tasks/cancel` (A2A spec §3.1.5). The agent may reject this with
 * TaskNotCancelableError if the task is already in a terminal state --
 * that comes back as a normal error response, not a special case here.
 */
export async function POST(request: Request, context: { params: Promise<{ agentId: string; taskId: string }> }) {
  const { agentId, taskId } = await context.params;
  const agent = await agentRegistry().get(agentId);
  if (!agent) return NextResponse.json({ error: { message: "Unknown agent." } }, { status: 404 });
  try {
    const tenant = new URL(request.url).searchParams.get("tenant") ?? "";
    const result = await executeOperation({
      connection: { cardUrl: agent.cardUrl, auth: { type: "none" }, headers: {} },
      action: "cancelTask",
      params: { taskId, tenant },
    });
    await createTaskObserver({ agentId: agent.id, tenant, sessionId: result.sessionId!, requestId: result.requestId!, source: "command_response" })({ task: result.result } as JsonValue);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
