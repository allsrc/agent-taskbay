"use client";

import { create } from "zustand";
import { viewAgentCard, type AgentView } from "@/lib/agent-card";

export interface CatalogAgent {
  id: string;
  cardUrl: string;
  source: "env" | "managed";
  /** Undefined when discovery failed; see `error`. */
  view?: AgentView;
  error?: string;
}

interface AgentStoreState {
  agents: CatalogAgent[];
  status: "idle" | "loading" | "ready" | "error";
  refresh: () => Promise<void>;
}

/** The registered agents with their discovered cards; shared by every screen that names an agent. */
export const useAgentStore = create<AgentStoreState>()((set, get) => ({
  agents: [],
  status: "idle",
  refresh: async () => {
    if (get().status === "loading") return;
    set({ status: "loading" });
    try {
      const response = await fetch("/api/agents", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not load agents.");
      const agents: CatalogAgent[] = (body.agents as Array<{ id: string; cardUrl: string; source: "env" | "managed"; card?: unknown; error?: string }>).map(
        (entry) => ({
          id: entry.id,
          cardUrl: entry.cardUrl,
          source: entry.source,
          view: entry.card ? viewAgentCard(entry.card) : undefined,
          error: entry.error,
        }),
      );
      set({ agents, status: "ready" });
    } catch {
      set({ status: "error" });
    }
  },
}));

export const agentName = (agents: CatalogAgent[], id: string, fallback = id) =>
  agents.find((agent) => agent.id === id)?.view?.name ?? fallback;
