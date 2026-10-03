import { RateLimitError } from "@/server/adapters/db/security-repository";
import { publicSecurityRateLimit } from "@/server/runtime/security";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { loadAuthConfig } from "@/server/adapters/auth/config";
import { OidcIdentityAdapter, openFlow, opaqueToken, tokenHash, safeReturnTo } from "@/server/adapters/auth/oidc";
import { DatabaseIdentityRepository } from "@/server/adapters/db/identity-repository";
import { withRequestEntityManager } from "@/server/adapters/db/orm";
import { LOGIN_COOKIE, SESSION_COOKIE } from "@/server/runtime/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let response: NextResponse;
  try {
    await publicSecurityRateLimit("callback");
    const config = loadAuthConfig();
    if (config.mode !== "oidc") throw new Error("OIDC disabled.");
    const jar = await cookies();
    const cookie = jar.get(LOGIN_COOKIE)?.value;
    if (!cookie || !/^[A-Za-z0-9_-]{43}$/.test(cookie)) throw new Error("Missing login attempt.");
    const sealed = await withRequestEntityManager((em) => new DatabaseIdentityRepository(em).consumeLogin(tokenHash(cookie), new Date()));
    if (!sealed) throw new Error("Login attempt expired or already used.");
    const flow = await openFlow(sealed, config.flowKey);
    const external = await new OidcIdentityAdapter(config).complete(new URL(request.url), flow);
    const token = opaqueToken();
    await withRequestEntityManager((em) => em.transactional(async (tx) => {
      const identities = new DatabaseIdentityRepository(tx);
      const principal = await identities.resolveExternal(external.issuer, external.subject, config.organizationSlug);
      if (!principal) throw new Error("No enabled membership.");
      // Rotate any existing authenticated session during a fresh login.
      const previous = jar.get(SESSION_COOKIE)?.value;
      if (previous) await identities.revokeSession(tokenHash(previous));
      await identities.createSession(tokenHash(token), principal, new Date(Date.now() + config.sessionSeconds * 1000));
      await identities.appendAudit(principal, "session.started", principal.membershipId);
    }));
    response = NextResponse.redirect(new URL(safeReturnTo(flow.returnTo), config.origin), 303);
    response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: config.sessionSeconds });
  } catch (error) {
    // Never reflect provider responses, tokens, state, code or internal errors.
    response = NextResponse.json({ error: { message: error instanceof RateLimitError ? "Too many sign-in requests." : "Sign-in failed. Start a new sign-in attempt." } }, { status: error instanceof RateLimitError ? 429 : 401 });
  }
  response.cookies.set(LOGIN_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
