// Which advertised interface a connection uses, and what the Connection card shows about it.
// Pure (no SDK, server or React imports) so the gateway, the agent catalog route and the screens share one rule.

export interface InterfaceLike {
  url: string;
  protocolBinding: string;
  protocolVersion: string;
  tenant?: string;
}

/** The parts of a saved connection that pin an interface. */
export interface InterfacePin {
  interfaceUrl?: string;
  protocolBinding?: string;
  protocolVersion?: string;
}

/** What the Connection card on the agent page shows. Built on the server from the stored card and the saved connection. */
export interface ConnectionView {
  binding: string | null;
  interfaceUrl: string | null;
  protocolVersion: string | null;
  /** The tenant a new conversation sends when the person does not choose one. Empty when the card declares none. */
  tenant: string;
  /** Every distinct tenant the card's interfaces declare. */
  tenants: string[];
  /** True when the saved connection settings fix the interface, binding or version. */
  pinned: boolean;
  negotiated: string[];
  ignored: string[];
  required: string[];
  unsupportedRequired: string[];
}

const TRANSPORTS = ["JSONRPC", "HTTP+JSON"];

export function availableInterfaces<T extends InterfaceLike>(interfaces: T[], config: InterfacePin): T[] {
  return interfaces.filter((item) => TRANSPORTS.includes(item.protocolBinding.toUpperCase()) &&
    (!config.interfaceUrl || item.url === config.interfaceUrl) &&
    (!config.protocolBinding || item.protocolBinding.toUpperCase() === config.protocolBinding.toUpperCase()) &&
    (!config.protocolVersion || item.protocolVersion === config.protocolVersion));
}

export function selectAdvertisedInterface<T extends InterfaceLike>(interfaces: T[], config: InterfacePin): T | undefined {
  return interfaces.find((item) =>
    (!config.interfaceUrl || item.url === config.interfaceUrl) &&
    (!config.protocolBinding || item.protocolBinding.toUpperCase() === config.protocolBinding.toUpperCase()) &&
    (!config.protocolVersion || item.protocolVersion === config.protocolVersion),
  );
}

export const isPinned = (config: InterfacePin) => Boolean(config.interfaceUrl || config.protocolBinding || config.protocolVersion);

/**
 * The interface the gateway connects to. gRPC is never used. A pinned connection narrows to the one matching interface
 * (`selected` is undefined when it is no longer advertised). An explicit tenant selects its own interface within those pins.
 * Then choose by binding order, and per binding the last 1.0 interface, else the first.
 */
export function chooseConnectionInterface<T extends InterfaceLike>(interfaces: T[], config: InterfacePin, tenant?: string): { pinned: boolean; selected?: T } {
  const pinned = isPinned(config);
  const usable = availableInterfaces(interfaces, config);
  // An interface without a tenant can route explicit tenants. Prefer an exact declaration when one exists.
  const exact = tenant ? usable.filter((item) => item.tenant === tenant) : [];
  const unscoped = usable.filter((item) => !item.tenant);
  const candidates = tenant ? exact.length ? exact : unscoped : tenant === "" && unscoped.length ? unscoped : usable;
  const best = new Map<string, T>();
  for (const item of candidates) {
    const key = item.protocolBinding.toUpperCase();
    if (!best.has(key) || item.protocolVersion === "1.0") best.set(key, item);
  }
  const order = [...(config.protocolBinding ? [config.protocolBinding] : []), ...candidates.map((item) => item.protocolBinding)].map((name) => name.toUpperCase());
  for (const name of order) {
    const found = best.get(name);
    if (found && TRANSPORTS.includes(name)) return { pinned, selected: found };
  }
  return { pinned };
}

/** Distinct tenants in card order, including the empty option for mixed cards. Empty when none declares a tenant. */
export function advertisedTenants(interfaces: InterfaceLike[]): string[] {
  const tenants = [...new Set(availableInterfaces(interfaces, {}).map((item) => item.tenant ?? ""))];
  return tenants.length === 1 && tenants[0] === "" ? [] : tenants;
}

/** The tenant a new conversation uses unless the person picks another: the only tenant, else the selected interface's, else none. */
export function defaultTenant(tenants: string[], selected?: InterfaceLike): string {
  if (selected) return selected.tenant ?? "";
  if (tenants.length <= 1) return tenants[0] ?? "";
  return tenants[0];
}

/** A stored public card supplies the same default used by the gateway, before intent is persisted. */
export function cardInterfaces(card: unknown): InterfaceLike[] {
  const interfaces = (card as { supportedInterfaces?: unknown } | undefined)?.supportedInterfaces;
  return (Array.isArray(interfaces) ? interfaces : []).filter((item): item is InterfaceLike => Boolean(item) &&
    typeof item.url === "string" && typeof item.protocolBinding === "string" && typeof item.protocolVersion === "string" &&
    (item.tenant === undefined || typeof item.tenant === "string"));
}

export function cardDefaultTenant(card: unknown): string {
  return chooseConnectionInterface(cardInterfaces(card), {}, "").selected?.tenant ?? "";
}

export function buildConnectionView(
  interfaces: InterfaceLike[],
  config: InterfacePin,
  extensions: { advertised: string[]; negotiated: string[]; required: string[]; unsupportedRequired: string[] },
): ConnectionView {
  const { pinned, selected } = chooseConnectionInterface(interfaces, config);
  const tenants = advertisedTenants(availableInterfaces(interfaces, config));
  const ignored = extensions.advertised.filter((uri) => !extensions.negotiated.includes(uri) && !extensions.unsupportedRequired.includes(uri));
  return {
    binding: selected?.protocolBinding ?? null,
    interfaceUrl: selected?.url ?? null,
    protocolVersion: selected?.protocolVersion ?? null,
    tenant: defaultTenant(tenants, selected),
    tenants,
    pinned,
    negotiated: extensions.negotiated,
    ignored,
    required: extensions.required,
    unsupportedRequired: extensions.unsupportedRequired,
  };
}
