import type { NormalizedPart } from "@/lib/types";

/** A2UI v0.9 (a2ui.org). Opt-in by Agent Card extension, Basic Catalog only, an allowlisted component subset (ADR 0022). */
export const A2UI_EXTENSION_URI = "https://a2ui.org/a2a-extension/a2ui/v0.9";
export const A2UI_BASIC_CATALOG_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";
/** v0.9.1 standardized `application/a2ui+json`; v0.9 documents used `application/json+a2ui`. Both carry the same envelopes. */
export const A2UI_MEDIA_TYPES = ["application/a2ui+json", "application/json+a2ui"];

export const A2UI_LIMITS = { components: 200, depth: 20, surfaces: 8, messages: 100, modelBytes: 64 * 1024, text: 5_000, options: 50, id: 128, contextBytes: 16 * 1024 } as const;

/** Components this client renders. Everything else in the catalog degrades to an inert placeholder. */
export const A2UI_SUPPORTED_COMPONENTS = ["Text", "Row", "Column", "Card", "Divider", "Button", "TextField", "CheckBox", "ChoicePicker"] as const;

type Json = unknown;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const hasOwn = (target: object, key: string) => Object.prototype.hasOwnProperty.call(target, key);

export interface A2uiSurface {
  id: string;
  catalogId: string;
  /** False when the agent chose a catalog this client does not implement; nothing from it is rendered. */
  supported: boolean;
  components: Map<string, Record<string, unknown>>;
  model: Record<string, unknown>;
}
export interface A2uiState { surfaces: Map<string, A2uiSurface>; rejected: number }

export const newA2uiState = (): A2uiState => ({ surfaces: new Map(), rejected: 0 });

/** True when the part carries A2UI envelopes. Callers must also check the agent advertised the extension. */
export function isA2uiPart(part: NormalizedPart): boolean {
  if (part.kind !== "data" || !Array.isArray(part.value)) return false;
  const declared = part.metadata && typeof part.metadata.mimeType === "string" ? part.metadata.mimeType : undefined;
  return A2UI_MEDIA_TYPES.includes(part.mediaType) || (declared !== undefined && A2UI_MEDIA_TYPES.includes(declared));
}

/** RFC 6901 pointer to path segments; rejects anything that is not an absolute pointer. */
export function parsePointer(pointer: unknown): string[] | undefined {
  if (typeof pointer !== "string" || pointer.length > 512) return undefined;
  if (pointer === "" || pointer === "/") return [];
  if (!pointer.startsWith("/")) return undefined;
  const segments = pointer.slice(1).split("/").map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  return segments.some((segment) => segment === "__proto__" || segment === "constructor" || segment === "prototype") ? undefined : segments;
}

export function getPointer(model: Record<string, unknown>, pointer: string): unknown {
  const segments = parsePointer(pointer);
  if (!segments) return undefined;
  let current: unknown = model;
  for (const segment of segments) {
    if (Array.isArray(current)) current = /^\d+$/.test(segment) ? current[Number(segment)] : undefined;
    else if (isObject(current) && hasOwn(current, segment)) current = current[segment];
    else return undefined;
  }
  return current;
}

/** Sets or (value undefined) deletes; creates intermediate objects. Returns false for an unsafe or impossible path. */
export function setPointer(model: Record<string, unknown>, pointer: string, value: unknown): boolean {
  const segments = parsePointer(pointer);
  if (!segments || segments.length === 0) return false;
  let current: Record<string, unknown> | unknown[] = model;
  for (const segment of segments.slice(0, -1)) {
    const next: unknown = Array.isArray(current) ? current[/^\d+$/.test(segment) ? Number(segment) : -1] : (hasOwn(current, segment) ? current[segment] : undefined);
    if (isObject(next) || Array.isArray(next)) { current = next as Record<string, unknown> | unknown[]; continue; }
    if (Array.isArray(current) || next !== undefined) return false;
    if (value === undefined) return true;
    const created: Record<string, unknown> = {};
    current[segment] = created;
    current = created;
  }
  const last = segments.at(-1)!;
  if (Array.isArray(current)) {
    if (!/^\d+$/.test(last)) return false;
    if (value === undefined) current.splice(Number(last), 1); else current[Number(last)] = value;
  } else if (value === undefined) delete current[last];
  else current[last] = value;
  return true;
}

const bytes = (value: unknown) => { try { return JSON.stringify(value)?.length ?? 0; } catch { return Infinity; } };
const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const idOk = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= A2UI_LIMITS.id;

/** Applies one server-to-client envelope. Invalid envelopes are skipped and counted; the rest of the list still applies. */
export function applyMessage(state: A2uiState, message: Json): void {
  const reject = () => { state.rejected++; };
  if (!isObject(message) || message.version !== "v0.9") return reject();
  const keys = Object.keys(message).filter((key) => key !== "version");
  if (keys.length !== 1) return reject();
  const body = message[keys[0]];
  if (!isObject(body) || !idOk(body.surfaceId)) return reject();
  const surfaceId = body.surfaceId;
  switch (keys[0]) {
    case "createSurface": {
      if (typeof body.catalogId !== "string" || body.catalogId.length > 512) return reject();
      if (!state.surfaces.has(surfaceId) && state.surfaces.size >= A2UI_LIMITS.surfaces) return reject();
      state.surfaces.set(surfaceId, { id: surfaceId, catalogId: body.catalogId, supported: body.catalogId === A2UI_BASIC_CATALOG_ID, components: new Map(), model: {} });
      return;
    }
    case "updateComponents": {
      const surface = state.surfaces.get(surfaceId);
      if (!surface || !Array.isArray(body.components) || body.components.length === 0) return reject();
      const incoming = new Map(surface.components);
      for (const component of body.components) {
        if (!isObject(component) || !idOk(component.id) || typeof component.component !== "string" || component.component.length > 64) return reject();
        incoming.set(component.id, component);
      }
      if (incoming.size > A2UI_LIMITS.components) return reject();
      surface.components = incoming;
      return;
    }
    case "updateDataModel": {
      const surface = state.surfaces.get(surfaceId);
      if (!surface) return reject();
      const path = body.path === undefined ? "/" : body.path;
      const segments = parsePointer(path);
      if (!segments) return reject();
      const next = cloneJson(surface.model);
      if (segments.length === 0) {
        if (body.value !== undefined && !isObject(body.value)) return reject();
        surface.model = body.value === undefined ? {} : cloneJson(body.value as Record<string, unknown>);
        if (bytes(surface.model) > A2UI_LIMITS.modelBytes) { surface.model = {}; return reject(); }
        return;
      }
      if (!setPointer(next, path as string, body.value === undefined ? undefined : cloneJson(body.value)) || bytes(next) > A2UI_LIMITS.modelBytes) return reject();
      surface.model = next;
      return;
    }
    case "deleteSurface":
      state.surfaces.delete(surfaceId);
      return;
    default:
      return reject();
  }
}

/** Folds every A2UI part of a task's agent messages, oldest first, into the current surfaces. */
export function surfacesFromParts(parts: NormalizedPart[]): A2uiState {
  const state = newA2uiState();
  let seen = 0;
  for (const part of parts) {
    if (!isA2uiPart(part)) continue;
    for (const message of part.value as unknown[]) {
      if (seen++ >= A2UI_LIMITS.messages * 20) return state;
      applyMessage(state, message);
    }
  }
  return state;
}

export type Edits = Array<[pointer: string, value: unknown]>;
/** The agent's data model with the viewer's own input layered on top. */
export function effectiveModel(surface: A2uiSurface, edits: Edits = []): Record<string, unknown> {
  const model = cloneJson(surface.model);
  for (const [pointer, value] of edits) setPointer(model, pointer, value);
  return model;
}

/** Literal or absolute data binding. Function calls and relative paths are unsupported and resolve to `undefined`. */
export function resolveValue(value: unknown, model: Record<string, unknown>): unknown {
  if (isObject(value)) return hasOwn(value, "path") && Object.keys(value).length === 1 ? getPointer(model, value.path as string) : undefined;
  return Array.isArray(value) || value === null ? undefined : value;
}
export const isBinding = (value: unknown): value is { path: string } => isObject(value) && typeof value.path === "string" && Object.keys(value).length === 1 && parsePointer(value.path) !== undefined;
export const asText = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "").slice(0, A2UI_LIMITS.text);

export interface A2uiEvent { name: string; context: Record<string, unknown> }
/** Valid `action.event` of a Button, or undefined for anything else (including local function calls). */
export function readEvent(action: unknown, model: Record<string, unknown>): A2uiEvent | undefined {
  if (!isObject(action) || !isObject(action.event) || hasOwn(action, "functionCall")) return undefined;
  const { name, context } = action.event;
  if (typeof name !== "string" || name.length === 0 || name.length > A2UI_LIMITS.id) return undefined;
  const resolved: Record<string, unknown> = {};
  if (context !== undefined) {
    if (!isObject(context)) return undefined;
    for (const [key, value] of Object.entries(context)) {
      if (key === "__proto__" || key.length > A2UI_LIMITS.id) return undefined;
      const result = resolveValue(value, model);
      if (result !== undefined) resolved[key] = result;
    }
  }
  return bytes(resolved) > A2UI_LIMITS.contextBytes ? undefined : { name, context: resolved };
}

/** The client-to-server `action` envelope sent back to the agent as an A2UI data part. */
export const buildActionMessage = (surfaceId: string, sourceComponentId: string, event: A2uiEvent, now: Date = new Date()) =>
  ({ version: "v0.9", action: { name: event.name, surfaceId, sourceComponentId, timestamp: now.toISOString(), context: event.context } });

/** Declared on every message to an agent that advertises the extension so it can choose a catalog it knows we render. */
export const a2uiClientMetadata = () => ({ a2uiClientCapabilities: { "v0.9": { supportedCatalogIds: [A2UI_BASIC_CATALOG_ID] } } });
