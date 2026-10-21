/** The longest nickname an administrator can give an agent. */
export const MAX_AGENT_NICKNAME_LENGTH = 100;

/**
 * Trims a nickname and refuses one that is too long or holds control characters. An empty value clears the nickname (null).
 * The nickname is the administrator's own name for a registration; the Agent Card name is whatever the agent advertises.
 */
export function normalizeNickname(value: string | null | undefined): string | null {
  const nickname = (value ?? "").replace(/\s+/g, " ").trim();
  if (!nickname) return null;
  if (nickname.length > MAX_AGENT_NICKNAME_LENGTH) throw new Error(`Nickname must be at most ${MAX_AGENT_NICKNAME_LENGTH} characters.`);
  if (/[\u0000-\u001f\u007f]/.test(nickname)) throw new Error("Nickname must not contain control characters.");
  return nickname;
}

/** Thrown when another agent already has the nickname. */
export class NicknameTakenError extends Error {
  constructor(nickname: string) { super(`Another agent is already called “${nickname}”. Nicknames are unique so they can tell agents apart.`); }
}

/** A nickname is unique, ignoring case, among the organization's enabled agents. A removed agent frees its nickname. */
export function assertNicknameFree(
  agents: ReadonlyArray<{ id: string; enabled: boolean; nickname?: string | null }>, agentId: string, nickname: string,
): void {
  const wanted = nickname.toLowerCase();
  if (agents.some((agent) => agent.enabled && agent.id !== agentId && agent.nickname?.toLowerCase() === wanted)) throw new NicknameTakenError(nickname);
}
