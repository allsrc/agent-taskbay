import { viewAgentCard, type AgentSkill } from "./agent-card";

/** Deliberately excludes endpoints, security metadata, raw cards and signatures. */
export interface ExtendedCardView {
  fetchedAt: string;
  skills: AgentSkill[];
  capabilities: { streaming: boolean; pushNotifications: boolean };
}

export function viewExtendedCard(card: unknown, fetchedAt: Date): ExtendedCardView {
  const view = viewAgentCard(card);
  return { fetchedAt: fetchedAt.toISOString(), skills: view.skills,
    capabilities: { streaming: view.streaming, pushNotifications: view.pushNotifications } };
}

/** Only the agent detail screen calls this; grant and chat selectors keep public skills. */
export function mergeExtendedSkills(publicSkills: AgentSkill[], extended?: ExtendedCardView) {
  const ids = new Set(publicSkills.map((skill) => skill.id));
  return [...publicSkills.map((skill) => ({ ...skill, authenticated: false })),
    ...(extended?.skills ?? []).filter((skill) => {
      if (ids.has(skill.id)) return false;
      ids.add(skill.id); return true;
    }).map((skill) => ({ ...skill, authenticated: true }))];
}
