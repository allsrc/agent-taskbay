import Link from "next/link";
import { ArrowRight, CircleAlert, Sparkles } from "lucide-react";

import { agentRegistry } from "@/lib/agent-registry";
import { discoverAgent } from "@/lib/gateway";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddAgentDialog } from "@/components/catalog/add-agent-dialog";
import { RemoveAgentButton } from "@/components/catalog/remove-agent-button";

export const dynamic = "force-dynamic";

interface CatalogRow {
  id: string;
  cardUrl: string;
  source: "env" | "managed";
  name?: string;
  description?: string;
  skillCount?: number;
  error?: string;
}

async function loadCatalog(): Promise<CatalogRow[]> {
  const agents = await agentRegistry().list();
  return Promise.all(
    agents.map(async (agent): Promise<CatalogRow> => {
      try {
        const discovery = await discoverAgent({ cardUrl: agent.cardUrl, auth: { type: "none" }, headers: {} });
        const card = discovery.card as { name?: string; description?: string; skills?: unknown[] };
        return {
          id: agent.id,
          cardUrl: agent.cardUrl,
          source: agent.source,
          name: card.name ?? agent.cardUrl,
          description: card.description,
          skillCount: Array.isArray(card.skills) ? card.skills.length : 0,
        };
      } catch (error) {
        return {
          id: agent.id,
          cardUrl: agent.cardUrl,
          source: agent.source,
          error: error instanceof Error ? error.message : "Agent discovery failed.",
        };
      }
    }),
  );
}

export default async function CatalogPage() {
  const entries = await loadCatalog();

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agent catalog</h1>
          <p className="text-muted-foreground mt-1 max-w-prose text-sm">
            The org&apos;s registered A2A agents. Start a task with one to open a conversation thread.
          </p>
        </div>
        <AddAgentDialog />
      </header>

      {!entries.length ? (
        <Card className="items-center border-dashed py-14 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <Sparkles className="text-primary size-7" />
            <p className="font-medium">No agents registered</p>
            <p className="text-muted-foreground max-w-md text-sm">
              Register one above, or set <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">A2A_REGISTERED_AGENTS</code> to
              a comma-separated list of Agent Card URLs.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((entry) => (
            <Card key={entry.id} className="group relative transition-shadow hover:shadow-md">
              {entry.source === "managed" && (
                <div className="absolute top-3 right-3 opacity-0 transition-opacity group-hover:opacity-100">
                  <RemoveAgentButton agentId={entry.id} agentName={entry.name ?? entry.cardUrl} />
                </div>
              )}
              {entry.error ? (
                <>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-destructive">
                      <CircleAlert className="size-4 shrink-0" />
                      <span className="truncate">{entry.cardUrl}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-destructive/90 text-sm">{entry.error}</p>
                  </CardContent>
                </>
              ) : (
                <>
                  <CardHeader>
                    <CardTitle className="pr-6">{entry.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-4">
                    {entry.description && (
                      <p className="text-muted-foreground line-clamp-3 text-sm">{entry.description}</p>
                    )}
                    <div className="mt-auto flex items-center justify-between pt-2">
                      <Badge variant="secondary">
                        {entry.skillCount} skill{entry.skillCount === 1 ? "" : "s"}
                      </Badge>
                      <Link
                        href={`/catalog/${entry.id}`}
                        className="text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline"
                      >
                        Open
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </div>
                  </CardContent>
                </>
              )}
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
