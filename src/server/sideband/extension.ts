import { STRUCTURED_FORM_EXTENSION_URI } from "../../lib/structured-form";
import { A2UI_EXTENSION_URI } from "../../lib/a2ui";
import { APPROVAL_REQUEST_EXTENSION_URI } from "../application/services/agent-approval";
import { SKILL_ROUTING_EXTENSION } from "../application/services/access-policy";
import type { AgentCard } from "@a2a-js/sdk";
import { sidebandExtensionUris } from "../runtime/runtime-config";

export function advertisedExtensionUris(card: AgentCard): string[] {
  return card.capabilities?.extensions?.map((extension) => extension.uri).filter(Boolean) ?? [];
}

export function negotiateSidebandExtensions(card: AgentCard): string[] {
  const understood = new Set(sidebandExtensionUris());
  return advertisedExtensionUris(card).filter((uri) => understood.has(uri));
}

/** Every extension Taskbay understands: the negotiated sideband ones plus the ones its screens render. */
export function understoodExtensionUris(): string[] {
  return [...new Set([...sidebandExtensionUris(), STRUCTURED_FORM_EXTENSION_URI, A2UI_EXTENSION_URI, APPROVAL_REQUEST_EXTENSION_URI, SKILL_ROUTING_EXTENSION])];
}

type CardWithExtensions = { capabilities?: { extensions?: Array<{ uri?: unknown; required?: unknown }> } };

/** Extension URIs a card marks `required: true`. */
export function requiredExtensionUris(card: unknown): string[] {
  const extensions = (card as CardWithExtensions | undefined)?.capabilities?.extensions;
  return (Array.isArray(extensions) ? extensions : []).filter((extension) => extension && extension.required === true && typeof extension.uri === "string" && extension.uri)
    .map((extension) => String(extension.uri));
}

/** Required extensions Taskbay does not understand: a client that cannot honor them cannot expect the interaction to work. */
export function unsupportedRequiredExtensionUris(card: unknown, understood: readonly string[] = understoodExtensionUris()): string[] {
  return requiredExtensionUris(card).filter((uri) => !understood.includes(uri));
}
