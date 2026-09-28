import { NextResponse } from "next/server";
import { discoverAgent } from "@/lib/gateway";
import { agentRegistry } from "@/lib/agent-registry";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await context.params;
  const agent = await agentRegistry().get(agentId);
  if (!agent) return NextResponse.json({ error: { message: "Unknown agent." } }, { status: 404 });
  try {
    const discovery = await discoverAgent({ cardUrl: agent.cardUrl, auth: { type: "none" }, headers: {} });
    return NextResponse.json({ id: agent.id, cardUrl: agent.cardUrl, card: discovery.card, report: discovery.report }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
