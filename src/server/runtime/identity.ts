import { takeRateLimit } from "../adapters/db/security-repository";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { MikroORM } from "@mikro-orm/core";
import type { Principal } from "../application/ports/identity";
import { AuthenticationError, authorize, type Permission } from "../application/services/authorization";
import { bootstrapDefaultLocalOrganization } from "../application/services/bootstrap-default-organization";
import { DatabaseIdentityRepository, provisionIdentity } from "../adapters/db/identity-repository";
import { withRequestEntityManager } from "../adapters/db/orm";
import { createPersistenceRepositories } from "../adapters/db/repositories";
import { loadAuthConfig } from "../adapters/auth/config";
import { tokenHash } from "../adapters/auth/oidc";
import { withPrincipal } from "../adapters/auth/principal-context";

export const SESSION_COOKIE = "__Host-a2a-session";
export const LOGIN_COOKIE = "__Host-a2a-login";

export async function resolvePrincipal(cookie?: string, orm?: MikroORM): Promise<Principal | undefined> {
  const config = loadAuthConfig();
  return withRequestEntityManager(async (em) => {
    const identity = new DatabaseIdentityRepository(em);
    if (config.mode === "development") {
      const org = await bootstrapDefaultLocalOrganization(createPersistenceRepositories(em).organizations);
      const existing = await identity.resolveExternal("agent-taskbay:development", "local-operator", org.slug);
      // A disabled membership/user stays disabled; development does not reactivate it.
      if (existing) return existing;
      const { ExternalIdentityEntity } = await import("../adapters/db/entities");
      if (await em.findOne(ExternalIdentityEntity, { issuer: "agent-taskbay:development", subject: "local-operator" })) return;
      return provisionIdentity(em, { issuer: "agent-taskbay:development", subject: "local-operator", organizationId: org.id,
        displayName: "Local operator", role: "admin" });
    }
    if (!cookie || !/^[A-Za-z0-9_-]{43}$/.test(cookie)) return;
    return identity.resolveSession(tokenHash(cookie), new Date());
  }, orm);
}

/** Authenticates all application HTTP entry points, before parsing bodies or accessing data. */
export function authenticatedRoute<C>(permission: Permission, handler: (request: Request, context: C) => Promise<Response>) {
  return async (request: Request, context: C): Promise<Response> => {
    try {
      const jar = await cookies();
      const principal = await resolvePrincipal(jar.get(SESSION_COOKIE)?.value);
      if (!principal) throw new AuthenticationError();
      authorize(principal, permission);
      await withRequestEntityManager((em) => takeRateLimit(em, `user:${principal.membershipId}:${permission}`,
        permission === "read" ? 900 : permission === "operate" ? 120 : 60));
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) verifyMutationOrigin(request);
      return await withPrincipal(principal, () => handler(request, context));
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : 503;
      return NextResponse.json({ error: { message: status === 401 ? "Sign in to continue." :
        status === 403 ? "This action is not permitted." : status === 429 ? "Too many requests. Try again shortly." : "Identity service unavailable." } },
      { status, headers: { "Cache-Control": "no-store" } });
    }
  };
}

export function verifyMutationOrigin(request: Request) {
  const config = loadAuthConfig();
  const origin = request.headers.get("origin");
  const expected = config.mode === "oidc" ? config.origin : new URL(request.url).origin;
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
  let developmentLoopback = false;
  if (config.mode === "development" && origin) {
    try {
      const supplied = new URL(origin), target = new URL(expected);
      developmentLoopback = supplied.origin === origin && loopback.has(supplied.hostname) && loopback.has(target.hostname) &&
        supplied.protocol === target.protocol && supplied.port === target.port;
    } catch { /* Invalid Origin remains rejected. */ }
  }
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== expected && !developmentLoopback) ||
    (config.mode === "oidc" && !origin)) {
    const error = new Error("Cross-origin request rejected.") as Error & { status: number };
    error.status = 403;
    throw error;
  }
}
