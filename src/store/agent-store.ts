"use client";

import { create } from "zustand";
import type { ConnectionView } from "@/lib/connection-interface";
import { viewAgentCard, type AgentView } from "@/lib/agent-card";

export interface CatalogAgent {
  extendedCard?: import("@/lib/extended-card").ExtendedCardView;
  id: string;
  cardUrl: string;
  source: "env" | "managed";
  /** The administrator's own name for this agent. When set it is also `view.name`; the card's own name is `cardName`. */
  nickname?: string;
  cardName?: string;
  /** Undefined when discovery failed; see `error`. */
  view?: AgentView;
  trust?: string;
  error?: string;
  /** Interface, protocol version, tenants and extensions this connection uses. */
  connection?: ConnectionView;
  /** Required extensions the card declares, which of them Taskbay cannot honor, and the administrator override. */
  extensions?: { required: string[]; unsupportedRequired: string[]; override: boolean };
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
      const agents: CatalogAgent[] = (body.agents as Array<{ id: string; cardUrl: string; source: "env" | "managed"; nickname?: string; card?: unknown; trust?: string; error?: string; extensions?: CatalogAgent["extensions"]; connection?: ConnectionView; extendedCard?: CatalogAgent["extendedCard"] }>).map(
        (entry) => {
          const card = entry.card ? viewAgentCard(entry.card) : undefined;
          return {
          id: entry.id,
          cardUrl: entry.cardUrl,
          source: entry.source,
          nickname: entry.nickname || undefined, cardName: card?.name,
          // Every screen names an agent by `view.name`, so the nickname replaces the card name there.
          view: card && entry.nickname ? { ...card, name: entry.nickname } : card,
          error: entry.error, trust: entry.trust, extensions: entry.extensions, connection: entry.connection,
          extendedCard: entry.extendedCard,
          };
        },
      );
      set({ agents, status: "ready" });
    } catch {
      set({ status: "error" });
    }
  },
}));

export const agentName = (agents: CatalogAgent[], id: string, fallback = id) => {
  const agent = agents.find((item) => item.id === id);
  return agent?.nickname ?? agent?.view?.name ?? fallback;
};

/** The card's own name when a nickname hides it, else undefined. Show it beside the nickname so the advertised name stays visible. */
export const advertisedName = (agent: CatalogAgent | undefined) =>
  agent?.nickname && agent.cardName && agent.cardName !== agent.nickname ? agent.cardName : undefined;

/** A one-line label for pickers: the nickname with the card name in brackets, else the name. */
export const agentOptionLabel = (agent: CatalogAgent, fallback: string) => {
  const advertised = advertisedName(agent);
  return `${agent.view?.name ?? fallback}${advertised ? ` (${advertised})` : ""}`;
};
