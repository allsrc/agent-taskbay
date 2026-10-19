"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/a2a/primitives";
import { AdminDataProvider } from "@/components/admin/admin-data";
import { AdminNav } from "@/components/admin/admin-nav";
import { PageMessage } from "@/components/console/page";
import { buttonVariants } from "@/components/ui/button";
import { useServerResource } from "@/lib/use-server-resource";

/** Organization administration: people, teams, agent access, policies. Every API behind it enforces the role too. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = useServerResource<{ user: { role: string } }>("/api/auth/session");
  if (session.loading) return <PageMessage>Loading administration…</PageMessage>;
  if (session.data?.user.role !== "admin") {
    return (
      <EmptyState icon={ShieldCheck} title="Administrators only" action={<Link href="/settings" className={buttonVariants({ variant: "outline" })}>Back to settings</Link>}>
        Managing people, teams and agent access is limited to administrators.
      </EmptyState>
    );
  }
  return (
    <AdminDataProvider>
      <div className="flex flex-1 flex-col md:min-h-0">
        <AdminNav />
        {children}
      </div>
    </AdminDataProvider>
  );
}
