import { createHmac, timingSafeEqual } from "node:crypto";
import type { PushCredentials } from "../application/ports/push";

/** Secrets never leave the server; errors deliberately omit supplied values. */
export function loadPushCredentials(environment: Readonly<Record<string, string | undefined>> = process.env): PushCredentials | undefined {
  const originValue = environment.A2A_PUSH_CALLBACK_ORIGIN;
  if (!originValue) return undefined;
  const key = environment.A2A_PUSH_SIGNING_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key)) throw new Error("A2A_PUSH_SIGNING_KEY must contain 64 hexadecimal characters.");
  let origin: URL;
  try { origin = new URL(originValue); } catch { throw new Error("Invalid A2A_PUSH_CALLBACK_ORIGIN."); }
  const local = environment.A2A_PUSH_ALLOW_LOOPBACK_HTTP === "true" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if ((origin.protocol !== "https:" && !(local && origin.protocol === "http:")) || origin.username || origin.password ||
      origin.pathname !== "/" || origin.search || origin.hash) throw new Error("A2A_PUSH_CALLBACK_ORIGIN requires an HTTPS origin (or explicitly enabled loopback HTTP).");
  const credentials: PushCredentials = {
    callbackUrl: (registration) => `${origin.origin}/api/webhooks/a2a/${registration.id}`,
    token: (registration) => createHmac("sha256", Buffer.from(key, "hex"))
      .update(JSON.stringify(["a2a-task-push-v1", registration.organizationId, registration.id])).digest("base64url"),
    authenticate: (registration, authorization) => {
      const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i)?.[1];
      if (!token) return false;
      return timingSafeEqual(Buffer.from(token), Buffer.from(credentials.token(registration)));
    },
  };
  return credentials;
}
