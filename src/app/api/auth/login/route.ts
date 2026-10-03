import { RateLimitError } from "@/server/adapters/db/security-repository";
import { publicSecurityRateLimit } from "@/server/runtime/security";
import { NextResponse } from "next/server";
import { loadAuthConfig } from "@/server/adapters/auth/config";
import { OidcIdentityAdapter, opaqueToken, tokenHash, sealFlow } from "@/server/adapters/auth/oidc";
import { DatabaseIdentityRepository } from "@/server/adapters/db/identity-repository";
import { withRequestEntityManager } from "@/server/adapters/db/orm";
import { LOGIN_COOKIE } from "@/server/runtime/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await publicSecurityRateLimit("login");
    const config = loadAuthConfig();
    if (config.mode === "development") return NextResponse.redirect(new URL("/tasks", request.url), 303);
    const { flow, url } = await new OidcIdentityAdapter(config).begin(new URL(request.url).searchParams.get("returnTo"));
    const token = opaqueToken();
    const encrypted = await sealFlow(flow, config.flowKey);
    await withRequestEntityManager((em) => new DatabaseIdentityRepository(em).saveLogin(
      tokenHash(token), encrypted, new Date(Date.now() + 600_000)));
    const response = NextResponse.redirect(url, 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set(LOGIN_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
    return response;
  } catch (error) {
    return Response.json({ error: { message: error instanceof RateLimitError ? "Too many sign-in requests." : "Sign-in service unavailable." } }, { status: error instanceof RateLimitError ? 429 : 503, headers: { "Cache-Control": "no-store" } });
  }
}
