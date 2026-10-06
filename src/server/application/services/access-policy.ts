import type { Principal } from "../ports/identity";
import type { AccessGrant, AgentPermission } from "../ports/security";
import { AuthorizationError, authorize } from "./authorization";

export const SKILL_ROUTING_EXTENSION = "https://extensions.allsrc.dev/agent-taskbay/skill-routing/v1";

/** Fail closed. A skill grant never authorizes an unrestricted generic send. */
export class AccessPolicy {
  constructor(readonly principal: Principal, readonly grants: AccessGrant[]) {}
  allows(agentId: string, permission: AgentPermission, skillId: string | null = null): boolean {
    if (permission === "operate" && this.principal.role === "viewer") return false;
    if (this.principal.role === "admin") return true;
    return this.grants.some((grant) => grant.enabled && grant.organizationId === this.principal.organizationId &&
      grant.agentId === agentId && (permission === "read" || grant.permission === "operate") &&
      (grant.skillId === null || (skillId !== null && grant.skillId === skillId)));
  }
  discovers(agentId: string): boolean {
    return this.principal.role === "admin" || this.grants.some((grant) => grant.enabled &&
      grant.organizationId === this.principal.organizationId && grant.agentId === agentId);
  }
  require(agentId: string, permission: AgentPermission, skillId: string | null = null) {
    authorize(this.principal, permission);
    if (!this.allows(agentId, permission, skillId)) throw new AuthorizationError();
  }
  filterCard(agentId: string, card: Record<string, unknown>): Record<string, unknown> {
    if (this.allows(agentId, "read")) return card;
    // A partial catalog view cannot disclose other skills in examples, metadata or a signature payload.
    const skills = Array.isArray(card.skills) ? card.skills.filter((skill) => skill && typeof skill === "object" &&
      typeof (skill as {id?: unknown}).id === "string" && this.allows(agentId, "read", (skill as {id: string}).id)) : [];
    return { name: card.name, description: "Restricted skill access", version: card.version,
      supportedInterfaces: card.supportedInterfaces, capabilities: {streaming: (card.capabilities as {streaming?: boolean})?.streaming},
      defaultInputModes: card.defaultInputModes, defaultOutputModes: card.defaultOutputModes, skills,
      access: { requiresSkill: true } };
  }
}
