"use client";

import Link from "next/link";
import type { Route } from "next";
import { Callout } from "@/components/patterns/data-display";
import { ScreenTitle } from "@/components/navigation/screen-title";
import { ListSkeleton } from "@/components/patterns/collections";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A list with a detail pane. From `md` up both show side by side and scroll independently. On a phone only one
 * shows at a time: the list, or the open item (the mobile top bar supplies the back button).
 */
export function MasterDetail({ list, children, showDetail }: { list: React.ReactNode; children: React.ReactNode; showDetail: boolean }) {
  return (
    <div className="flex flex-1 md:min-h-0">
      <section
        aria-label="List"
        className={cn("w-full flex-col bg-background md:flex md:min-h-0 md:w-72 md:shrink-0 md:border-r lg:w-80 xl:w-96", showDetail ? "hidden" : "flex")}
      >
        {list}
      </section>
      <section aria-label="Detail" className={cn("min-w-0 flex-1 flex-col md:flex md:min-h-0", showDetail ? "flex" : "hidden")}>
        {children}
      </section>
    </div>
  );
}

/** The list half: title, optional controls (filters), scrolling body and optional footer. */
export function ListPane({
  title,
  description,
  actions,
  controls,
  footer,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  controls?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <ScreenTitle title={title} />
      <header className="shrink-0 space-y-3 px-4 pt-5 pb-3 md:pt-6">
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 flex-1 font-heading text-xl font-semibold tracking-tight">{title}</h1>
          {actions}
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {controls}
      </header>
      <div className="border-t md:min-h-0 md:flex-1 md:overflow-auto">{children}</div>
      {footer && <footer className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-2.5 text-sm">{footer}</footer>}
    </>
  );
}

/** One row of a list. `active` marks the open item. */
export function ListRow({ href, active, children, className }: { href: string; active?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <Link
      href={href as Route}
      transitionTypes={["nav-forward"]}
      aria-current={active ? "true" : undefined}
      className={cn(
        "relative flex flex-col gap-1.5 border-b px-4 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted",
        active && "bg-accent before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-brand",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Loading, error and empty states for a list body. Renders nothing while there are rows. */
export function ListStatus({
  loading,
  error,
  empty,
  onRetry,
  emptyText,
  loadingLabel,
}: {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  onRetry?: () => void;
  emptyText?: React.ReactNode;
  loadingLabel: string;
}) {
  return (
    <>
      {loading && (
        <div role="status" aria-label={loadingLabel} className="p-4">
          <ListSkeleton rows={4} />
        </div>
      )}
      {error && (
        <div className="p-4">
          <Callout tone="danger" action={onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>}>
            {error}
          </Callout>
        </div>
      )}
      {!loading && !error && empty && <p className="p-4 text-sm text-muted-foreground">{emptyText}</p>}
    </>
  );
}
