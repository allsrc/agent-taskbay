import Link from "next/link";
import { CircleAlert, Sparkles } from "lucide-react";
import { agentRegistry } from "@/lib/agent-registry";
import { discoverAgent } from "@/lib/gateway";

export const dynamic = "force-dynamic";

async function loadCatalog() {
  const agents = await agentRegistry().list();
  return Promise.all(agents.map(async (agent) => {
    try {
      const discovery = await discoverAgent({ cardUrl: agent.cardUrl, auth: { type: "none" }, headers: {} });
      const card = discovery.card as { name?: string; description?: string; skills?: Array<{ id: string; name: string }> };
      return { id: agent.id, cardUrl: agent.cardUrl, name: card.name ?? agent.cardUrl, description: card.description, skillCount: card.skills?.length ?? 0 };
    } catch (error) {
      return { id: agent.id, cardUrl: agent.cardUrl, error: error instanceof Error ? error.message : "Agent discovery failed." };
    }
  }));
}

export default async function CatalogPage() {
  const entries = await loadCatalog();
  return (
    <section className="catalog-page">
      <header className="section-heading">
        <div>
          <h1>Agent catalog</h1>
          <p>The org&apos;s registered A2A agents. Start a task with one to open a conversation thread.</p>
        </div>
      </header>
      {!entries.length ? (
        <div className="empty-card">
          <Sparkles size={27} />
          <strong>No agents registered</strong>
          <p>Set <code>A2A_REGISTERED_AGENTS</code> to a comma-separated list of Agent Card URLs, or replace <code>src/lib/agent-registry.ts</code> with a real directory-service-backed implementation.</p>
        </div>
      ) : (
        <div className="catalog-grid">
          {entries.map((entry) => (
            <article className="catalog-card" key={entry.id}>
              {"error" in entry && entry.error ? (
                <>
                  <header><CircleAlert size={16} /><strong>{entry.cardUrl}</strong></header>
                  <p className="catalog-card-error">{entry.error}</p>
                </>
              ) : (
                <>
                  <header><strong>{entry.name}</strong></header>
                  {entry.description && <p>{entry.description}</p>}
                  <div className="catalog-card-foot">
                    <span>{entry.skillCount} skill{entry.skillCount === 1 ? "" : "s"}</span>
                    <Link className="button primary" href={`/catalog/${entry.id}`}>Open</Link>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
