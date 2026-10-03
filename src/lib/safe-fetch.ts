import { Agent, fetch as undiciFetch } from "undici";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { addressAllowed, resolveTarget, validateTargetUrl } from "./url-safety";
import type { AuthConfig, ConnectionConfig, WireEvent } from "./types";

export const MAX_AGENT_RESPONSE_BYTES = 25 * 1024 * 1024;
export function authHeaders(auth: AuthConfig): Record<string, string> {
  switch (auth.type) {
    case "bearer": return auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
    case "basic": return { Authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}` };
    case "apiKey": return auth.name && auth.value ? { [auth.name]: auth.value } : {};
    default: return {};
  }
}
export function redactSecrets<T>(value: T, secrets: string[] = []): T {
  const needles = secrets.filter(Boolean).flatMap((secret) => [secret, Buffer.from(secret).toString("base64"), encodeURIComponent(secret)]);
  const visit = (item: unknown): unknown => {
    if (typeof item === "string") return needles.reduce((text, needle) => text.split(needle).join("[redacted]"), item);
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => {
      if (["raw", "bytes"].includes(key) && typeof child === "string" && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(child)) {
        let bytes = Buffer.from(child, "base64");
        for (const secret of secrets.filter(Boolean)) {
          const needle = Buffer.from(secret); let offset = bytes.indexOf(needle);
          while (offset >= 0) {
            bytes = Buffer.concat([bytes.subarray(0, offset), Buffer.from("[redacted]"), bytes.subarray(offset + needle.length)]);
            offset = bytes.indexOf(needle, offset + 10);
          }
        }
        return [visit(key) as string, bytes.toString("base64")];
      }
      return [visit(key) as string, visit(child)];
    }));
    return item;
  };
  return visit(value) as T;
}

/** Each socket resolves and validates the exact address it connects to. No redirect or ambient proxy. */
export function createSafeFetch(options: Pick<ConnectionConfig, "auth" | "headers"> & {
  telemetry: WireEvent[]; timeoutMs: number; credentialOrigins?: string[]; secrets?: string[];
  tls?: {cert?: string; key?: string; ca?: string};
}): typeof fetch {
  return async (input, init) => {
    const source = input instanceof Request ? input : undefined;
    const url = validateTargetUrl(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    await resolveTarget(url.href);
    if (options.credentialOrigins && !options.credentialOrigins.includes(url.origin)) throw new Error("Agent credential destination is not permitted.");
    const dispatcher = new Agent({ connect: {
      ...options.tls, rejectUnauthorized: true,
      lookup(hostname, lookupOptions, callback) {
        void lookup(hostname, {all: true, verbatim: true}).then((addresses) => {
          if (!addresses.length || addresses.some(({address}) => !addressAllowed(address))) throw new Error("Agent network address is blocked.");
          const available = lookupOptions.family ? addresses.filter((address) => address.family === lookupOptions.family) : addresses;
          if (!available.length) throw new Error("No allowed network address.");
          if (lookupOptions.all) callback(null, available);
          else callback(null, available[0].address, available[0].family);
        }).catch(() => callback(new Error("Agent network connection rejected."), "", 0));
      },
    } });
    // Literal IPs bypass lookup, so validate them at every fetch admission.
    if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && !addressAllowed(url.hostname.replace(/^\[|\]$/g, ""))) {
      await dispatcher.destroy(); throw new Error("Agent network address is blocked.");
    }
    const headers = new Headers(source?.headers);
    new Headers(init?.headers).forEach((value,key) => headers.set(key,value));
    Object.entries(options.headers).forEach(([key,value]) => headers.set(key,value));
    Object.entries(authHeaders(options.auth)).forEach(([key,value]) => headers.set(key,value));
    headers.delete("cookie"); headers.delete("proxy-authorization"); headers.delete("host");
    const method = init?.method ?? source?.method ?? "GET";
    const started = performance.now();
    // Wire views have fixed protocol facts only. Neither custom header names nor raw bodies are exposed.
    options.telemetry.push({id: crypto.randomUUID(), timestamp: new Date().toISOString(), phase: "request", method, url: url.href});
    try {
      const response = await undiciFetch(url, { ...init, headers, redirect: "manual", dispatcher,
        signal: AbortSignal.any([AbortSignal.timeout(options.timeoutMs), ...(init?.signal ? [init.signal] : [])]) } as Parameters<typeof undiciFetch>[1]);
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error("Agent redirects are not permitted."); }
      if (Number(response.headers.get("content-length") ?? 0) > MAX_AGENT_RESPONSE_BYTES) {
        await response.body?.cancel(); throw new Error("Agent response exceeds the safety limit.");
      }
      options.telemetry.push({id: crypto.randomUUID(), timestamp: new Date().toISOString(), phase: "response", method, url: url.href,
        status: response.status, durationMs: Math.round(performance.now() - started)});
      const reader = response.body?.getReader();
      let total = 0;
      const body = reader ? new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const {done,value} = await reader.read();
            if (done) { controller.close(); await dispatcher.close(); return; }
            total += value.byteLength;
            if (total > MAX_AGENT_RESPONSE_BYTES) throw new Error("Agent response exceeds the safety limit.");
            controller.enqueue(value);
          } catch (error) { controller.error(error); await reader.cancel().catch(() => undefined); await dispatcher.destroy(); }
        },
        async cancel() { await reader.cancel().catch(() => undefined); await dispatcher.destroy(); },
      }) : null;
      const responseHeaders = new Headers();
      for (const key of ["content-type", "content-length", "cache-control"]) {
        const value = response.headers.get(key); if (value) responseHeaders.set(key,value);
      }
      if (!reader) await dispatcher.close();
      return new Response(body, {status: response.status, headers: responseHeaders});
    } catch { await dispatcher.destroy(); throw new Error("Agent network request failed."); }
  };
}
