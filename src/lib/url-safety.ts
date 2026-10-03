import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

export function privateNetworksAllowed(): boolean {
  return process.env.A2A_ALLOW_PRIVATE_NETWORKS === "true" ||
    (process.env.NODE_ENV !== "production" && process.env.A2A_ALLOW_PRIVATE_NETWORKS !== "false");
}
export function addressAllowed(address: string, allowPrivate = privateNetworksAllowed()): boolean {
  try {
    const parsed = ipaddr.process(address);
    const range = parsed.range();
    return range === "unicast" || (allowPrivate && ["private", "uniqueLocal", "loopback"].includes(range));
  } catch { return false; }
}
export function validateTargetUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Enter a valid absolute agent URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("Agent URLs must use HTTP(S) without credentials, query strings or fragments.");
  const production = process.env.NODE_ENV === "production";
  const demo = process.env.A2A_AUTH_MODE === "development" && process.env.A2A_ALLOW_DEVELOPMENT_AUTH === "true";
  const origins = (process.env.A2A_ALLOWED_AGENT_ORIGINS ?? "").split(",").filter(Boolean).map((value) => {
    const configured = new URL(value.trim());
    if (configured.href !== `${configured.origin}/`) throw new Error("Agent allowlist entries must be exact origins.");
    return configured.origin;
  });
  if ((origins.length || production) && !origins.includes(url.origin)) throw new Error("Agent target is not in the configured origin allowlist.");
  if (production && !demo && url.protocol !== "https:") throw new Error("Production agent targets require HTTPS.");
  return url;
}
export async function resolveTarget(input: string, resolver = lookup) {
  const url = validateTargetUrl(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolver(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({address}) => !addressAllowed(address))) throw new Error("Agent network address is blocked.");
  return { url, addresses };
}
export async function assertSafeUrl(input: string): Promise<URL> { return (await resolveTarget(input)).url; }
export async function assertSafeInterfaceUrl(input: string, protocolBinding?: string): Promise<void> {
  // The SDK gRPC factory does not expose a connection-bound resolver. Do not let it bypass this policy.
  if (protocolBinding?.toUpperCase() === "GRPC") throw new Error("gRPC transport is unavailable under the hardened network policy; advertise an HTTP binding.");
  await assertSafeUrl(input);
}
export async function assertSafeAgentCard(card: Record<string, unknown>): Promise<void> {
  const urls: string[] = [];
  if (typeof card.url === "string") urls.push(card.url);
  if (Array.isArray(card.supportedInterfaces)) for (const entry of card.supportedInterfaces) {
    if (entry && typeof entry === "object" && typeof entry.url === "string" && entry.protocolBinding?.toUpperCase() !== "GRPC") urls.push(entry.url);
  }
  await Promise.all(urls.map(assertSafeUrl));
}
