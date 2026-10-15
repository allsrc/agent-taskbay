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
 * (`selected` is undefined when it is no longer advertised). Then the A2A SDK client factory picks: the preferred binding
 * first, then card order, and per binding the last 1.0 interface, else the first.
 */
export function chooseConnectionInterface<T extends InterfaceLike>(interfaces: T[], config: InterfacePin): { pinned: boolean; selected?: T } {
  const usable = interfaces.filter((item) => item.protocolBinding.toUpperCase() !== "GRPC");
  const pinned = isPinned(config);
  const candidates = pinned ? [selectAdvertisedInterface(usable, config)].filter((item): item is T => Boolean(item)) : usable;
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

/** Distinct tenants the interfaces declare, in card order. Empty when none declares one. */
export function advertisedTenants(interfaces: InterfaceLike[]): string[] {
  return [...new Set(interfaces.filter((item) => item.protocolBinding.toUpperCase() !== "GRPC").map((item) => item.tenant ?? "").filter(Boolean))];
}

/** The tenant a new conversation uses unless the person picks another: the only tenant, else the selected interface's, else none. */
export function defaultTenant(tenants: string[], selected?: InterfaceLike): string {
  if (tenants.length <= 1) return tenants[0] ?? "";
  return selected?.tenant && tenants.includes(selected.tenant) ? selected.tenant : tenants[0];
}

export function buildConnectionView(
  interfaces: InterfaceLike[],
  config: InterfacePin,
  extensions: { advertised: string[]; negotiated: string[]; required: string[]; unsupportedRequired: string[] },
): ConnectionView {
  const { pinned, selected } = chooseConnectionInterface(interfaces, config);
  const tenants = advertisedTenants(interfaces);
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
