import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, authenticatedRoute } from "@/server/runtime/identity";
import { currentPrincipal } from "@/server/adapters/auth/principal-context";
import { tokenHash } from "@/server/adapters/auth/oidc";
import { DatabaseIdentityRepository } from "@/server/adapters/db/identity-repository";
import { withRequestEntityManager } from "@/server/adapters/db/orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = authenticatedRoute("read", async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await withRequestEntityManager((em) => em.transactional(async (tx) => {
    const identity = new DatabaseIdentityRepository(tx);
    await identity.revokeSession(tokenHash(token));
    await identity.appendAudit(currentPrincipal()!, "session.ended", currentPrincipal()!.membershipId);
  }));
  const response = NextResponse.json({ signedOut: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
});
