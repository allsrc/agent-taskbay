import { authenticatedRoute } from "@/server/runtime/identity";
import { NextResponse } from "next/server";
import { discoverRegisteredAgent } from "@/server/runtime/agent-discovery";
import { agentRegistry } from "@/lib/agent-registry";
import { apiError } from "@/lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(_request: Request, context: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await context.params;
  const agent = await agentRegistry().get(agentId);
  if (!agent) return NextResponse.json({ error: { message: "Unknown agent." } }, { status: 404 });
  try {
    const discovery = await discoverRegisteredAgent(agent);
    return NextResponse.json(
      { id: agent.id, cardUrl: agent.cardUrl, source: agent.source, card: discovery.card, trust: discovery.trust, report: discovery.report },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

/** Catalog management: remove a managed agent. Env-seeded agents can't be removed from the UI. */
async function handleDELETE(_request: Request, context: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await context.params;
  const agent = await agentRegistry().get(agentId);
  if (!agent) return NextResponse.json({ error: { message: "Unknown agent." } }, { status: 404 });
  if (agent.source === "env") {
    return NextResponse.json(
      { error: { message: "This agent comes from A2A_REGISTERED_AGENTS and can't be removed from the UI." } },
      { status: 409 },
    );
  }
  const removed = await agentRegistry().remove(agentId);
  if (!removed) return NextResponse.json({ error: { message: "Agent could not be removed." } }, { status: 409 });
  return NextResponse.json({ removed: true }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = authenticatedRoute("read", handleGET);
export const DELETE = authenticatedRoute("administer", handleDELETE);
