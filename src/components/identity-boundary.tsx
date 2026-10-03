import { cookies } from "next/headers";
import { AppShell } from "./app-shell";
import { resolvePrincipal, SESSION_COOKIE } from "@/server/runtime/identity";
import { loadAuthConfig } from "@/server/adapters/auth/config";
import type { Principal } from "@/server/application/ports/identity";

export async function IdentityBoundary({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  let principal: Principal | undefined;
  let development = false;
  let unavailable = false;
  try {
    principal = await resolvePrincipal(jar.get(SESSION_COOKIE)?.value);
    development = loadAuthConfig().mode === "development";
  } catch {
    unavailable = true;
  }
  if (unavailable) return <main className="flex min-h-dvh items-center justify-center p-6"><p role="alert">Identity service unavailable. Contact your administrator.</p></main>;
  if (principal) return <AppShell identity={{ displayName: principal.displayName, role: principal.role, development }}>{children}</AppShell>;
  return <main className="flex min-h-dvh items-center justify-center p-6">
    <div className="bg-card border-border w-full max-w-sm space-y-4 rounded-xl border p-6">
      <h1 className="text-xl font-semibold">Sign in to A2A Ops</h1>
      <p className="text-muted-foreground text-sm">Use your organization account to access agents and tasks.</p>
      {/* Full navigation starts the cookie-based server login flow. */}
      <a href="/api/auth/login" className="bg-primary text-primary-foreground inline-block rounded-md px-4 py-2 text-sm font-medium">Sign in</a>
    </div>
  </main>;
}
