type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  examples: string[];
}

export interface AgentView {
  requiresSkill?: boolean;
  name: string;
  description: string;
  version: string;
  tenant?: string;
  bindings: string[];
  url?: string;
  streaming: boolean;
  pushNotifications: boolean;
  extendedCard: boolean;
  skills: AgentSkill[];
  /** Human-readable security scheme names, e.g. "OAuth 2.0", "API key". */
  security: string[];
  inputModes: string[];
  outputModes: string[];
  extensions: string[];
}

const SCHEME_LABELS: Record<string, string> = {
  oauth2: "OAuth 2.0",
  openidconnect: "OpenID Connect",
  apikey: "API key",
  http: "HTTP auth",
  mutualtls: "mutual TLS",
};

function schemeLabel(scheme: unknown, fallback: string): string {
  if (!isObj(scheme)) return fallback;
  // v1.0 wraps the scheme in a oneof-style field (`oauth2SecurityScheme`, ...); v0.3 uses `type`.
  const key = Object.keys(scheme).find((name) => name.endsWith("SecurityScheme")) ?? "";
  const type = String(scheme.type ?? key.replace("SecurityScheme", "")).toLowerCase();
  const inner = isObj(scheme[key]) ? (scheme[key] as Obj) : scheme;
  if (type === "http") return String(inner.scheme ?? "").toLowerCase() === "bearer" ? "Bearer token" : "HTTP auth";
  return SCHEME_LABELS[type] ?? fallback;
}

/** Reads an Agent Card defensively: v1.0 (`supportedInterfaces`) and older (`url`) shapes both work. */
export function viewAgentCard(card: unknown): AgentView {
  const c = isObj(card) ? card : {};
  const interfaces = Array.isArray(c.supportedInterfaces) ? c.supportedInterfaces.filter(isObj) : [];
  const capabilities = isObj(c.capabilities) ? c.capabilities : {};
  const schemes = isObj(c.securitySchemes) ? c.securitySchemes : {};
  const bindings = [...new Set(interfaces.map((item) => String(item.protocolBinding ?? "")).filter(Boolean))];
  if (!bindings.length && typeof c.preferredTransport === "string") bindings.push(c.preferredTransport);
  const skills: AgentSkill[] = (Array.isArray(c.skills) ? c.skills.filter(isObj) : []).map((skill) => ({
    id: String(skill.id ?? skill.name ?? ""),
    name: String(skill.name ?? skill.id ?? "skill"),
    description: String(skill.description ?? ""),
    examples: strings(skill.examples),
  }));
  const extensions = (Array.isArray(capabilities.extensions) ? capabilities.extensions.filter(isObj) : [])
    .map((item) => String(item.uri ?? ""))
    .filter(Boolean);
  return {
    requiresSkill: isObj(c.access) && c.access.requiresSkill === true,
    name: String(c.name ?? "Unnamed agent"),
    description: String(c.description ?? ""),
    version: String(c.version ?? "—"),
    tenant: interfaces.map((item) => item.tenant).find((tenant): tenant is string => typeof tenant === "string" && tenant.length > 0),
    bindings,
    url: String(interfaces[0]?.url ?? c.url ?? "") || undefined,
    streaming: capabilities.streaming === true,
    pushNotifications: capabilities.pushNotifications === true,
    extendedCard: capabilities.extendedAgentCard === true || c.supportsAuthenticatedExtendedCard === true,
    skills,
    security: Object.entries(schemes).map(([name, scheme]) => schemeLabel(scheme, name)),
    inputModes: strings(c.defaultInputModes),
    outputModes: strings(c.defaultOutputModes),
    extensions,
  };
}

/** A stable two-letter badge + accent colour per agent, like the prototype's AR / FL / HT chips. */
const ACCENTS = ["#8C8FFF", "#FF6B4A", "#5EE0A0", "#FFC65C", "#D08CFF"];
export function agentBadge(name: string, id: string): { short: string; color: string } {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const short = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "A").slice(0, 2)).toUpperCase();
  const hash = [...id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  return { short, color: ACCENTS[hash % ACCENTS.length] };
}
