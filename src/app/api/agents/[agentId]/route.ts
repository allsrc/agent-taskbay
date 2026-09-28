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
    return NextResponse.json(
      { id: agent.id, cardUrl: agent.cardUrl, source: agent.source, card: discovery.card, report: discovery.report },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

/** Catalog management: remove a managed agent. Env-seeded agents can't be removed from the UI. */
export async function DELETE(_request: Request, context: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await context.params;
  const agent = await agentRegistry().get(agentId);
  if (!agent) return NextResponse.json({ error: { message: "Unknown agent." } }, { status: 404 });
  if (agent.source === "env") {
    return NextResponse.json(
      { error: { message: "This agent comes from A2A_REGISTERED_AGENTS and can't be removed from the UI." } },
      { status: 409 },
    );
  }
  await agentRegistry().remove(agentId);
  return NextResponse.json({ removed: true }, { headers: { "Cache-Control": "no-store" } });
}
