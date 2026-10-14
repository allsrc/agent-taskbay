import { cookies } from "next/headers";
import { AppShell } from "./app-shell";
import { Logo } from "@/components/brand/logo";
import { Callout } from "@/components/patterns/data-display";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  if (unavailable) return <main className="flex min-h-dvh items-center justify-center p-6"><Callout tone="danger" title="Identity service unavailable"><span role="alert">Contact your administrator.</span></Callout></main>;
  if (principal) return <AppShell identity={{ displayName: principal.displayName, role: principal.role, development }}>{children}</AppShell>;
  return <main className="glow-brand flex min-h-dvh items-center justify-center p-6">
    <div className="bg-card w-full max-w-sm space-y-5 rounded-xl border p-6 shadow-elevated">
      <Logo />
      <div className="space-y-1.5">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Sign in to Agent Taskbay</h1>
        <p className="text-muted-foreground text-sm">Use your organization account to access agents and tasks.</p>
      </div>
      {/* Full navigation starts the cookie-based server login flow. */}
      <a href="/api/auth/login" className={cn(buttonVariants({ size: "lg" }), "w-full")}>Sign in</a>
    </div>
  </main>;
}
