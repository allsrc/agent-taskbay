import { NextResponse } from "next/server";
import { discoverAgent } from "@/lib/gateway";
import { agentRegistry } from "@/lib/agent-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface CatalogEntry {
  id: string;
  cardUrl: string;
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
      return { id: agent.id, cardUrl: agent.cardUrl, name: card.name, description: card.description, skills: card.skills };
    } catch (error) {
      return { id: agent.id, cardUrl: agent.cardUrl, error: error instanceof Error ? error.message : "Agent discovery failed." };
    }
  }));
  return NextResponse.json({ agents: entries }, { headers: { "Cache-Control": "no-store" } });
}
