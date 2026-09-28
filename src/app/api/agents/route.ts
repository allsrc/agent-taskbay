import { NextResponse } from "next/server";
import { discoverAgent } from "@/lib/gateway";
import { agentRegistry } from "@/lib/agent-registry";
import { apiError } from "@/lib/api-response";
import { readJsonRequest } from "@/lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface CatalogEntry {
  id: string;
  cardUrl: string;
  source: "env" | "managed";
  name?: string;
  description?: string;
  skills?: Array<{ id: string; name: string; description: string; tags: string[] }>;
  error?: string;
}

/**
 * Service-catalog view (design doc §7.2.1): admin-curated registry of the
 * org's known agents, each surfacing its advertised skills. A card that
 * fails discovery still appears, with `error` set, rather than disappearing
 * from the catalog silently.
 */
export async function GET() {
  const agents = await agentRegistry().list();
  const entries: CatalogEntry[] = await Promise.all(agents.map(async (agent) => {
    try {
      const discovery = await discoverAgent({ cardUrl: agent.cardUrl, auth: { type: "none" }, headers: {} });
      const card = discovery.card as { name?: string; description?: string; skills?: CatalogEntry["skills"] };
      return { id: agent.id, cardUrl: agent.cardUrl, source: agent.source, name: card.name, description: card.description, skills: card.skills };
    } catch (error) {
      return { id: agent.id, cardUrl: agent.cardUrl, source: agent.source, error: error instanceof Error ? error.message : "Agent discovery failed." };
    }
  }));
  return NextResponse.json({ agents: entries }, { headers: { "Cache-Control": "no-store" } });
}

/** Catalog management (design doc's "next features"): register a new agent by its Agent Card URL. */
export async function POST(request: Request) {
  try {
    const body = await readJsonRequest<{ cardUrl?: string }>(request);
    if (!body.cardUrl?.trim()) throw new Error("cardUrl is required.");
    const agent = await agentRegistry().add(body.cardUrl);
    return NextResponse.json({ agent }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, 400);
  }
}
