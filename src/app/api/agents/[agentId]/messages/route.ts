import { NextResponse } from "next/server";
import { executeOperation } from "@/lib/gateway";
import { agentRegistry } from "@/lib/agent-registry";
import { apiError } from "@/lib/api-response";
import { readJsonRequest } from "@/lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface SendBody {
  text?: string;
  parts?: unknown[];
  taskId?: string;
  contextId?: string;
}

/**
 * Blocking (non-streaming) `message/send`. The streaming counterpart lives
 * at `stream/route.ts` and is what the task detail view actually uses; this
 * exists for callers (webhooks, scripted starts) that want a single response.
 */
export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await context.params;
  const agent = await agentRegistry().get(agentId);
  if (!agent) return NextResponse.json({ error: { message: "Unknown agent." } }, { status: 404 });
  try {
    const body = await readJsonRequest<SendBody>(request);
    // TODO(design doc §5 Plane B): auth is always "none" until per-agent
    // service-identity/user-delegated credential acquisition is wired up.
    const result = await executeOperation({
      connection: { cardUrl: agent.cardUrl, auth: { type: "none" }, headers: {} },
      action: "send",
      params: { text: body.text, parts: body.parts, taskId: body.taskId, contextId: body.contextId },
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
